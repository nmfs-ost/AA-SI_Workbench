"""Which GCP project and bucket the Workbench works against, and which it could.

A developer works in ``ggn-nmfs-aa-dev-1`` and its bucket; most people work in
``ggn-nmfs-aa-prod-1``; someone else may have a project of their own. So the
project and bucket are a choice, made once per user and remembered on this
workstation, rather than one value baked into the server:

* **The choice** lives in ``~/.config/aa-si-workbench/gcp.json``
  (``AASI_CONFIG_DIR`` moves it). It decides the Derived panel's bucket, where
  Prepare EchoData writes, which project's NCEI cache table is listed, and the
  project every console tool the Workbench starts is told to use
  (``AALIBRARY_GCP_PROJECT_ID``, ``AALIBRARY_GCP_BUCKET_NAME``,
  ``GOOGLE_CLOUD_PROJECT``; see :func:`tool_env`).
* **Without a choice**, the deployment's environment decides as it always did
  (``AASI_GCP_PROJECT``, ``AASI_DERIVED_BUCKET``), and with neither, nothing is
  chosen: the card says so instead of guessing, so nobody's products land in
  a bucket they did not pick.
* **Discovery** (:func:`discover`) lists what this person can actually use,
  with the same Google credentials the data is read and written with
  (Application Default Credentials): the projects Resource Manager lets them
  see, plus a short list of known ones (``AASI_GCP_PROJECTS``) that are probed
  even when the project itself is not visible, because bucket access is often
  granted without project access. For each project, its buckets (all of them
  when it lets you list them, otherwise the conventional ``<project>-data``)
  and, for each bucket, whether you can read it and write to it
  (``testIamPermissions``, which answers for any caller), and whether the
  project has the NCEI cache table. When exactly one bucket can be written to,
  and you have not chosen or forgotten a choice, it is chosen for you.
* **The NCEI cache** is ``<project>.metadata.ncei_cache``. A project without
  one (discovery says so) reads the cache of a project that has it, so the
  Prepare card and aa-fetch always look files up in the same table.

Everything Google is behind :class:`Cloud`, so the tests run on a fake.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/gcp", tags=["gcp"])

#: Known projects, probed even when Resource Manager does not list them.
#: Production first: it is where most people work.
DEFAULT_CANDIDATES = ("ggn-nmfs-aa-prod-1", "ggn-nmfs-aa-dev-1")
#: The NCEI cache table every AA-SI project keeps, ``<project>.<this>``.
NCEI_CACHE_TABLE = "metadata.ncei_cache"
#: When nothing says otherwise, the NCEI cache aa-fetch has always read.
DEFAULT_NCEI_CACHE_PROJECT = "ggn-nmfs-aa-prod-1"

READ = ("storage.objects.list", "storage.objects.get")
WRITE = ("storage.objects.create",)

#: How long a discovery is reused before Google is asked again.
DISCOVERY_SECONDS = 300
#: At most this many projects are examined (known ones first).
MAX_PROJECTS = 60
#: At most this many buckets per project are tested.
MAX_BUCKETS = 12
#: Each Google call gives up after this long, without retrying: discovery is
#: a listing for a person waiting on it, not a job that must succeed.
CALL_SECONDS = 12
#: The whole discovery stops waiting after this long; projects not finished
#: are listed as not checked.
DISCOVERY_DEADLINE = 40

PROJECT_RE = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]")
BUCKET_RE = re.compile(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]")


# --------------------------------------------------------------------------- #
# Wire models
# --------------------------------------------------------------------------- #
class GcpContext(BaseModel):
    """The project and bucket in force, and why."""

    project: str = ""
    bucket: str = ""
    #: chosen (by this user) | discovered (the only writable bucket) |
    #: environment (the deployment's settings) | unset
    source: Literal["chosen", "discovered", "environment", "unset"] = "unset"
    #: Which project's NCEI cache table the card and aa-fetch read.
    nceiCacheProject: str = DEFAULT_NCEI_CACHE_PROJECT


class BucketAccess(BaseModel):
    name: str
    read: bool | None = None
    write: bool | None = None
    detail: str = ""


class ProjectInfo(BaseModel):
    id: str
    name: str = ""
    #: search (Resource Manager listed it) | known (AASI_GCP_PROJECTS, the
    #: credentials' or gcloud's project, the current choice)
    listedBy: Literal["search", "known"] = "known"
    buckets: list[BucketAccess] = Field(default_factory=list)
    #: Whether <project>.metadata.ncei_cache can be read; None: not checked.
    nceiCache: bool | None = None
    detail: str = ""


class Discovery(BaseModel):
    #: The account the credentials belong to, when Google says.
    account: str = ""
    projects: list[ProjectInfo] = Field(default_factory=list)
    #: Why something could not be looked at; the list is still usable.
    notes: list[str] = Field(default_factory=list)
    checkedAt: str = ""
    #: The context after discovery (it may have chosen for you).
    context: GcpContext = Field(default_factory=GcpContext)
    autoSelected: bool = False
    #: Every project was checked in time. A partial list chooses nothing for
    #: anyone and is reused only briefly.
    complete: bool = True


class Choice(BaseModel):
    project: str = ""
    bucket: str


# --------------------------------------------------------------------------- #
# The saved choice and the context in force
# --------------------------------------------------------------------------- #
_lock = threading.RLock()


def config_dir() -> Path:
    return Path(
        os.getenv("AASI_CONFIG_DIR", str(Path.home() / ".config" / "aa-si-workbench"))
    ).expanduser()


def _choice_file() -> Path:
    return config_dir() / "gcp.json"


def project_of_bucket(bucket: str) -> str:
    """The AA-SI convention: bucket ``<project>-data`` belongs to ``<project>``."""
    if bucket.endswith("-data") and PROJECT_RE.fullmatch(bucket[: -len("-data")]):
        return bucket[: -len("-data")]
    return ""


def _valid_project(value: object) -> str:
    """*value* when it is a project id, else "". Project ids reach SQL as
    table names, so nothing else gets through, from a file or the environment."""
    text = str(value or "").strip()
    return text if PROJECT_RE.fullmatch(text) else ""


def _valid_bucket(value: object) -> str:
    text = str(value or "").strip().removeprefix("gs://").strip("/")
    return text if BUCKET_RE.fullmatch(text) else ""


def _read_choice() -> dict:
    try:
        data = json.loads(_choice_file().read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _forgotten() -> bool:
    """The person said "forget my choice": do not choose for them again."""
    return bool(_read_choice().get("forgotten"))


def _saved() -> GcpContext | None:
    data = _read_choice()
    bucket = _valid_bucket(data.get("bucket"))
    if not bucket:
        return None
    project = _valid_project(data.get("project")) or project_of_bucket(bucket)
    if not project:
        return None
    source = "discovered" if data.get("source") == "discovered" else "chosen"
    return GcpContext(
        project=project,
        bucket=bucket,
        source=source,
        nceiCacheProject=_valid_project(data.get("nceiCacheProject")) or project,
    )


def current() -> GcpContext:
    """The project and bucket in force now. Cheap: one small file read."""
    with _lock:
        context = _saved()
    if context is None:
        # The deployment's settings, as before there was a choice. A bucket
        # named alone is taken as given: the deployment knows its bucket.
        project = _valid_project(os.getenv("AASI_GCP_PROJECT"))
        bucket = _valid_bucket(os.getenv("AASI_DERIVED_BUCKET"))
        project = project or project_of_bucket(bucket)
        if project or bucket:
            context = GcpContext(
                project=project,
                bucket=bucket or f"{project}-data",
                source="environment",
                nceiCacheProject=project,
            )
        else:
            context = GcpContext()
    context.nceiCacheProject = (
        _valid_project(os.getenv("AASI_NCEI_CACHE_PROJECT"))
        or (context.nceiCacheProject if context.source != "unset" else "")
        or DEFAULT_NCEI_CACHE_PROJECT
    )
    return context


def _discovered_project_of(bucket: str) -> str:
    """The project discovery found *bucket* in, if it looked."""
    found = _discovery  # one reference read: never waits on a discovery
    if found is None:
        return ""
    for info in found.projects:
        if any(b.name == bucket for b in info.buckets):
            return info.id
    return ""


def _cache_project_for(project: str) -> str:
    """Whose NCEI cache *project* reads: its own, unless it has none, then the
    first project known to have one (production when it does).

    The AA-SI projects keep the table. For any other project the answer comes
    from discovery when the server has one, else from asking Google once now
    (the CLI never discovers); when even that cannot tell, the project's own.
    """
    if project in DEFAULT_CANDIDATES:
        return project
    found = _discovery  # one reference read: never waits on a discovery
    by_id = {info.id: info for info in found.projects} if found else {}
    if project in by_id and by_id[project].nceiCache is not None:
        has = by_id[project].nceiCache
    else:
        try:
            has = _make_cloud().has_ncei_cache(project)
        except Exception:  # noqa: BLE001 - no credentials: cannot tell
            has = None
    if has is not False:
        return project
    having = [info.id for info in found.projects if info.nceiCache] if found else []
    if DEFAULT_NCEI_CACHE_PROJECT in having or not having:
        return DEFAULT_NCEI_CACHE_PROJECT
    return having[0]


def choose(project: str, bucket: str, *, source: str = "chosen") -> GcpContext:
    """Remember a project and bucket for this user.

    The project is the one typed, else the one the bucket's name says
    (``<project>-data``), else the one discovery found the bucket in. A bucket
    with no project is refused: every tool is told a project, and guessing one
    would send its queries and billing somewhere the person did not choose.
    """
    typed_bucket = bucket.strip().removeprefix("gs://").strip("/")
    typed_project = project.strip()
    if not typed_bucket and typed_project:
        typed_bucket = f"{typed_project}-data"
    bucket = _valid_bucket(typed_bucket)
    if not bucket:
        raise HTTPException(
            status_code=400, detail=f"Not a bucket name: {typed_bucket!r}"
        )
    if typed_project and not _valid_project(typed_project):
        raise HTTPException(
            status_code=400, detail=f"Not a project id: {typed_project!r}"
        )
    project = (
        typed_project or project_of_bucket(bucket) or _discovered_project_of(bucket)
    )
    if not project:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Which project is gs://{bucket} in? Its name does not say; "
                "type the project id too."
            ),
        )
    return _write_choice(project, bucket, source)


def _write_choice(project: str, bucket: str, source: str) -> GcpContext:
    record = {"project": project, "bucket": bucket, "source": source}
    cache = _cache_project_for(project)
    if cache != project:
        record["nceiCacheProject"] = cache
    _write({**record, "savedAt": _now()})
    _changed()
    return current()


def _write(data: dict) -> None:
    path = _choice_file()
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        os.replace(tmp, path)


def forget() -> GcpContext:
    """Drop the choice. The deployment's settings decide again, and nothing is
    chosen for this person automatically until they choose."""
    _write({"forgotten": True, "savedAt": _now()})
    _changed()
    return current()


_listeners: list = []


def on_change(callback) -> None:  # noqa: ANN001 - a no-argument callable
    """Run *callback* whenever the choice changes (providers drop their caches)."""
    _listeners.append(callback)


def _changed() -> None:
    for callback in list(_listeners):
        try:
            callback()
        except Exception:  # noqa: BLE001, S110 - a listener must not block a choice
            pass


def tool_env(
    context: GcpContext | None = None, *, ncei: bool = False
) -> dict[str, str]:
    """What every console tool started from the Workbench is told.

    aalibrary reads ``AALIBRARY_GCP_PROJECT_ID`` and ``…_BUCKET_NAME``; the
    Google client libraries bill to ``GOOGLE_CLOUD_PROJECT`` when they are not
    told a project. Products still go where their gs:// arguments say: those
    come from the same choice.

    *ncei* is for a tool that looks files up in the NCEI cache (aa-fetch reads
    ``<AALIBRARY_GCP_PROJECT_ID>.metadata.ncei_cache``): it is told the cache's
    project, the one the Prepare card listed the files from. *context* pins a
    snapshot, so every stage of one run works in the same project even if the
    choice changes while it runs.
    """
    context = context or current()
    env: dict[str, str] = {}
    project = context.nceiCacheProject if ncei else context.project
    if project:
        env["AALIBRARY_GCP_PROJECT_ID"] = project
        env["GOOGLE_CLOUD_PROJECT"] = project
    if context.bucket:
        env["AALIBRARY_GCP_BUCKET_NAME"] = context.bucket
    return env


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------- #
# Discovery
# --------------------------------------------------------------------------- #
class Cloud(Protocol):
    """The handful of Google calls discovery needs."""

    def account(self) -> tuple[str, str]:
        """(account email or '', the credentials' own project or '')."""

    def search_projects(self) -> list[tuple[str, str]]:
        """[(project id, display name)] the caller can see. May raise."""

    def list_buckets(self, project: str) -> list[str]:
        """Bucket names in *project*. Raises when listing is not allowed."""

    def permissions(self, bucket: str) -> set[str] | None:
        """Which of READ + WRITE the caller holds on *bucket*; None: no bucket."""

    def has_ncei_cache(self, project: str) -> bool | None:
        """Whether <project>.metadata.ncei_cache can be read; None: unknown."""


class GoogleCloud:
    """The real thing: Application Default Credentials, as the data uses."""

    def __init__(self) -> None:
        import google.auth

        self._credentials, self._project = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        self._storage = None

    def _session(self):  # noqa: ANN202
        from google.auth.transport.requests import AuthorizedSession

        return AuthorizedSession(self._credentials)

    def account(self) -> tuple[str, str]:
        email = getattr(self._credentials, "service_account_email", "") or ""
        if not email or email == "default":
            try:
                response = self._session().get(
                    "https://openidconnect.googleapis.com/v1/userinfo",
                    timeout=CALL_SECONDS,
                )
                if response.ok:
                    email = response.json().get("email", "") or ""
            except Exception:  # noqa: BLE001 - the account is a courtesy
                email = ""
        return email, self._project or ""

    def search_projects(self) -> list[tuple[str, str]]:
        session = self._session()
        found: list[tuple[str, str]] = []
        token = ""
        while len(found) < 500:
            params = {"pageSize": "300"}
            if token:
                params["pageToken"] = token
            response = session.get(
                "https://cloudresourcemanager.googleapis.com/v3/projects:search",
                params=params,
                timeout=CALL_SECONDS,
            )
            if not response.ok:
                raise RuntimeError(_google_error(response))
            data = response.json()
            for item in data.get("projects", []):
                if item.get("state", "ACTIVE") == "ACTIVE" and item.get("projectId"):
                    found.append((item["projectId"], item.get("displayName", "")))
            token = data.get("nextPageToken", "")
            if not token:
                break
        return found

    def _client(self):  # noqa: ANN202
        if self._storage is None:
            from google.cloud import storage

            self._storage = storage.Client(
                project=self._project or None, credentials=self._credentials
            )
        return self._storage

    def list_buckets(self, project: str) -> list[str]:
        buckets = self._client().list_buckets(
            project=project, max_results=MAX_BUCKETS, timeout=CALL_SECONDS, retry=None
        )
        return [bucket.name for bucket in buckets]

    def permissions(self, bucket: str) -> set[str] | None:
        from google.api_core import exceptions

        try:
            granted = (
                self._client()
                .bucket(bucket)
                .test_iam_permissions(
                    list(READ + WRITE), timeout=CALL_SECONDS, retry=None
                )
            )
        except exceptions.NotFound:
            return None
        return set(granted)

    def has_ncei_cache(self, project: str) -> bool | None:
        try:
            from google.api_core import exceptions
            from google.cloud import bigquery
        except ImportError:
            return None
        try:
            client = bigquery.Client(project=project, credentials=self._credentials)
            client.get_table(
                f"{project}.{NCEI_CACHE_TABLE}", retry=None, timeout=CALL_SECONDS
            )
            return True
        except exceptions.NotFound:
            return False
        except Exception:  # noqa: BLE001 - forbidden, API off: unknown
            return None


def _google_error(response) -> str:  # noqa: ANN001
    try:
        error = response.json().get("error", {})
        status, message = error.get("status", ""), error.get("message", "")
        return f"{response.status_code} {status}: {message}"
    except ValueError:
        return f"{response.status_code} {response.text[:200]}"


#: Replaced in tests.
def _make_cloud() -> Cloud:
    return GoogleCloud()


_discovery: Discovery | None = None
_discovered_at = 0.0
_discovery_lock = threading.Lock()


def candidates() -> list[str]:
    """Known projects, in the order they are offered."""
    named = os.getenv("AASI_GCP_PROJECTS", "")
    listed = [p.strip() for p in named.split(",") if p.strip()] or list(
        DEFAULT_CANDIDATES
    )
    return [p for p in listed if PROJECT_RE.fullmatch(p)]


def _gcloud_project() -> str:
    try:
        from .identity import _from_config_file

        return _from_config_file("project") or ""
    except Exception:  # noqa: BLE001 - a hint, not a requirement
        return ""


def _examine(cloud: Cloud, project: str) -> list[BucketAccess]:
    """The buckets of *project* this caller can see, with their access.

    Listing a project's buckets needs a project-level permission many people
    do not have even where they can read and write a bucket, so a refusal is
    not an answer: the conventional ``<project>-data`` bucket is always tried.
    """
    names: list[str] = []
    try:
        names = cloud.list_buckets(project)
    except Exception:  # noqa: BLE001, S110 - listing is often not granted
        pass
    conventional = f"{project}-data"
    if conventional not in names:
        names = [conventional, *names]
    out: list[BucketAccess] = []
    for name in names[:MAX_BUCKETS]:
        try:
            granted = cloud.permissions(name)
        except Exception as exc:  # noqa: BLE001
            out.append(BucketAccess(name=name, detail=_short(exc)))
            continue
        if granted is None:
            continue  # no such bucket (the convention did not hold)
        out.append(
            BucketAccess(
                name=name,
                read=all(p in granted for p in READ),
                write=all(p in granted for p in WRITE),
            )
        )
    return out


def _short(exc: Exception) -> str:
    text = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
    return text[:200]


def _rank(info: ProjectInfo, known: list[str]) -> tuple:
    writable = any(b.write for b in info.buckets)
    readable = any(b.read for b in info.buckets)
    order = known.index(info.id) if info.id in known else len(known)
    return (not writable, not readable, order, info.id)


def discover(*, refresh: bool = False) -> Discovery:
    """What this person can use. Cached for a few minutes; *refresh* asks again."""
    global _discovery, _discovered_at
    with _discovery_lock:
        age = time.monotonic() - _discovered_at
        keep = DISCOVERY_SECONDS if _discovery and _discovery.complete else 20
        if _discovery is None or refresh or age >= keep:
            _discovery, _discovered_at = _discover(), time.monotonic()
        result = _discovery.model_copy(deep=True)
    # Choose for the person only when there is nothing to choose between, and
    # only from a complete list: a project not checked in time may hold the
    # bucket they actually use.
    result.autoSelected = False
    writable = [(p.id, b.name) for p in result.projects for b in p.buckets if b.write]
    with _lock:
        # Checked and written under one lock, so a choice made meanwhile wins.
        context = current()
        if (
            context.source == "unset"
            and result.complete
            and len(writable) == 1
            and not _forgotten()
        ):
            project, bucket = writable[0]
            context = _write_choice(project, bucket, "discovered")
            result.autoSelected = True
    result.context = context
    return result


def _discover() -> Discovery:
    notes: list[str] = []
    try:
        cloud = _make_cloud()
    except Exception as exc:  # noqa: BLE001
        return Discovery(
            notes=[
                "No Google credentials: run `gcloud auth application-default login` "
                f"on the workstation, then look again. ({_short(exc)})"
            ],
            projects=[
                ProjectInfo(id=p, detail="Not checked: no Google credentials.")
                for p in candidates()
            ],
            checkedAt=_now(),
            context=current(),
        )
    account, own_project = cloud.account()

    known = candidates()
    for extra in (current().project, own_project, _gcloud_project()):
        if extra and PROJECT_RE.fullmatch(extra) and extra not in known:
            known.append(extra)

    names: dict[str, str] = {}
    listed: set[str] = set()
    try:
        for project, name in cloud.search_projects():
            names[project] = name
            listed.add(project)
    except Exception as exc:  # noqa: BLE001
        notes.append(
            "Could not list your projects (Resource Manager): "
            f"{_short(exc)}. Showing the known ones."
        )

    ordered = known + sorted(p for p in listed if p not in known)
    if len(ordered) > MAX_PROJECTS:
        notes.append(
            f"You can see {len(ordered)} projects; the first {MAX_PROJECTS} were "
            "checked. Type another below."
        )
        ordered = ordered[:MAX_PROJECTS]

    def one(project: str) -> ProjectInfo:
        info = ProjectInfo(
            id=project,
            name=names.get(project, ""),
            listedBy="search" if project in listed else "known",
        )
        try:
            info.buckets = _examine(cloud, project)
        except Exception as exc:  # noqa: BLE001
            info.detail = _short(exc)
        if any(b.read for b in info.buckets) or project in known:
            try:
                info.nceiCache = cloud.has_ncei_cache(project)
            except Exception:  # noqa: BLE001
                info.nceiCache = None
        return info

    pool = ThreadPoolExecutor(max_workers=12)
    futures = [pool.submit(one, project) for project in ordered]
    wait(futures, timeout=DISCOVERY_DEADLINE)
    # Never wait on a call that hangs: what finished is the answer.
    pool.shutdown(wait=False, cancel_futures=True)
    projects: list[ProjectInfo] = []
    late = 0
    for project, future in zip(ordered, futures, strict=True):
        if future.done() and not future.cancelled() and future.exception() is None:
            projects.append(future.result())
        else:
            late += 1
            projects.append(
                ProjectInfo(
                    id=project,
                    name=names.get(project, ""),
                    listedBy="search" if project in listed else "known",
                    detail="Not checked: Google took too long. Look again.",
                )
            )
    if late:
        notes.append(
            f"{late} project(s) took too long to check; nothing was chosen for you."
        )
    projects.sort(key=lambda info: _rank(info, known))
    unchecked = any(
        info.detail.startswith("Not checked") or any(b.detail for b in info.buckets)
        for info in projects
    )
    return Discovery(
        account=account,
        projects=projects,
        notes=notes,
        checkedAt=_now(),
        context=current(),
        complete=not unchecked,
    )


def _reset_for_tests(cloud_factory=None) -> None:  # noqa: ANN001
    global _discovery, _discovered_at, _make_cloud
    with _discovery_lock:
        _discovery, _discovered_at = None, 0.0
    if cloud_factory is not None:
        _make_cloud = cloud_factory


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.get("", response_model=GcpContext)
def get_context() -> GcpContext:
    return current()


@router.get("/discover", response_model=Discovery)
def get_discovery(refresh: bool = Query(False)) -> Discovery:
    return discover(refresh=refresh)


@router.post("", response_model=GcpContext)
def post_choice(choice: Choice) -> GcpContext:
    return choose(choice.project, choice.bucket)


class ForgetRequest(BaseModel):
    """A JSON body, so a form on another site cannot post this (no preflight)."""

    forget: bool = True


@router.post("/forget", response_model=GcpContext)
def post_forget(body: ForgetRequest) -> GcpContext:
    return forget() if body.forget else current()
