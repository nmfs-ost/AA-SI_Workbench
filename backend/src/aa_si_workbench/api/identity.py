"""Who is using this Workbench, and what the UI should offer them.

Read this before touching anything here
---------------------------------------
**This is not an authorization system, and it must never be mistaken for one.**

The Workbench runs *on* the user's own workstation, as that user. Every tool it
starts inherits their credentials, the terminal it exposes is an unrestricted
shell, and `AASI_FS_ROOT` bounds the filesystem for everyone identically. A
check in this file cannot stop anyone from doing anything: a user who wants the
action can run the tool directly in the terminal panel two clicks away.

What it *is* for is telling the user, before they click, that an action is going
to be refused by something downstream — and by whom. There are exactly two real
boundaries in this system and both live elsewhere:

* **GCP IAM**, for anything touching the bucket. `aa-upload` to a prefix you
  cannot write fails at Google's edge, correctly, whatever this file says.
* **`AASI_FS_READONLY`**, for the filesystem, enforced in `files.py` on every
  mutating route.

So `capabilities` below is a *prediction* of what those two will allow, offered
so a disabled button can explain itself instead of a job failing three minutes
in with a 403 from a service the user has never heard of. `enforced` is False
and stays False; a future version that genuinely enforced something would have
to say which boundary it added, because adding a check here would not be one.

Configuration
-------------
``AASI_PRINCIPAL``        override the detected account outright (tests, CI)
``AASI_PROJECT_MEMBERS``  comma-separated allowlist. Entries are either full
                          addresses (``ada@noaa.gov``) or domains (``@noaa.gov``).
                          **Unset means everyone**, which is the only safe
                          default for something that ships to workstations: an
                          allowlist that defaults to closed would lock a
                          scientist out of their own machine over a
                          misconfigured environment variable.
``AASI_FS_READONLY``      already read by files.py; mirrored into capabilities.
``AALIBRARY_GCP_PROJECT_ID``  the project id, when it should not be detected.

Detection
---------
The account is looked for in six places, in this order, and the first answer
wins. Each is tried once per process and the answer cached, because several of
them are slow enough to be felt on a panel that renders at startup.

1. ``AASI_PRINCIPAL``          our own override
2. ``CLOUDSDK_CORE_ACCOUNT``   gcloud's override. Someone who has set this has
                               already told the SDK who they are, and naming a
                               different account than ``gcloud`` does is worse
                               than naming none.
3. ``gcloud config get-value account``
4. ``gcloud auth list``        the *active credentialed* account
5. ``~/.config/gcloud/configurations/config_<name>``  read directly
6. the GCE/Cloud Workstation metadata server

Steps 2, 4 and 5 were added because step 3 alone reports nobody in three
situations that are all ordinary rather than exotic, and in each of them the
user is signed in and the Workbench said "No account detected":

* **They authenticated with ``gcloud auth application-default login``.** That
  writes application-default credentials and never sets the ``account``
  property, so step 3 returns ``(unset)`` for someone who is fully signed in.
  Step 4 finds them.
* **``gcloud`` is not on the server's ``PATH``.** The backend is often started
  from a desktop launcher or a unit file with a minimal environment, where the
  SDK's own shell-profile ``PATH`` entry never ran. Both subprocess probes fail
  with ``FileNotFoundError``; step 5 reads the same answer off disk without
  needing the binary at all.
* **Their account lives in a non-default configuration.** Step 5 honours
  ``CLOUDSDK_ACTIVE_CONFIG_NAME``, which is what selects between them.

Step 5 reports its source as ``gcloud`` rather than inventing a name for
itself: the file *is* gcloud's configuration, and the source field answers
"which account is this" — not "which syscall found it".

Only an email address is an account. gcloud's ``account`` setting can hold
anything, and Google's own instructions read ``gcloud config set account
ACCOUNT``: run as written, every probe above answers "ACCOUNT", and the user's
products went to ``derived_products/ACCOUNT/``. A value that isn't an address
is passed over (and the reason kept for the account check), and two more
places are asked before the metadata server: the one account gcloud holds
credentials for, when there is exactly one, and the account the
application-default credentials belong to.

The account check
-----------------
``GET /api/identity/check`` answers what the status bar can't in one word:
the account the Workbench names the user's folder after, the account the aa-*
tools actually upload with (the application-default credentials, which can be
a different one), and whether that account can read and write the chosen
bucket (asked of GCS, nothing written). Each problem comes with the command
that fixes it.
"""

from __future__ import annotations

import configparser
import os
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/identity", tags=["identity"])

#: Where the metadata server answers, on a Cloud Workstation or GCE VM. A root
#: rather than one URL, because the project id lives on the same server under a
#: different path and there is no reason to spell the host twice.
_METADATA_ROOT = "http://metadata.google.internal/computeMetadata/v1/"

#: Both external probes are on a short leash. This endpoint is called while the
#: shell is painting its first frame, and a workstation with no metadata server
#: and a slow DNS resolver would otherwise stall it.
_PROBE_TIMEOUT = 2.0

#: The account check runs on request, not at startup, and asks Google twice.
_CHECK_TIMEOUT = 6.0


class Capabilities(BaseModel):
    """What the UI should offer. A prediction, never a permission — see above."""

    #: Create, rename and save. False when AASI_FS_READONLY is set.
    writeFiles: bool = True
    #: Move to trash and restore. Same switch; separate flag because the UI
    #: distinguishes "can't edit" from "can't remove" in what it says.
    trashFiles: bool = True
    #: Start jobs through the runner.
    runJobs: bool = True
    #: Publish derived products to the bucket (`aa-upload`). The one capability
    #: with a real boundary behind it, and the reason this module exists.
    publish: bool = True


class Identity(BaseModel):
    principal: str = ""
    #: How `principal` was determined: env | gcloud | metadata | unknown.
    source: str = "unknown"
    project: str = ""
    #: Whether `principal` matches the configured allowlist. True when no
    #: allowlist is configured, which is the default.
    member: bool = True
    #: Whether an allowlist was configured at all. The UI says nothing about
    #: membership when this is False, because "member of nothing" is noise.
    restricted: bool = False
    capabilities: Capabilities = Capabilities()
    #: Always False. Present so a client cannot read this payload as a grant
    #: without reading the word that says it isn't one.
    enforced: bool = False
    #: Phrased for a person, and shown verbatim in the UI.
    detail: str = ""


def _bool_env(name: str) -> bool:
    return os.getenv(name, "").lower() in {"1", "true", "yes"}


def _from_gcloud() -> str:
    """The account `gcloud` is configured with, or "".

    `shell=False` and an explicit argv, like every other subprocess in this
    codebase. A missing gcloud is the common case on a laptop and is not an
    error worth surfacing — it just means this layer has no answer.
    """
    try:
        result = subprocess.run(  # noqa: S603 - fixed argv, no shell
            ["gcloud", "config", "get-value", "account"],
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    account = result.stdout.strip()
    # gcloud prints this literal string, on stdout, with exit status 0, when no
    # account is set. Treating it as an address would put "(unset)" in the UI.
    if not account or account == "(unset)":
        return ""
    return account


def _from_gcloud_auth_list() -> str:
    """The active *credentialed* account, or "".

    This is the one that finds a user who ran ``gcloud auth application-default
    login`` and nothing else. That flow deposits working credentials without
    ever setting the ``account`` property, so `_from_gcloud` above reports
    ``(unset)`` for somebody who is completely signed in — which is the single
    most common way this endpoint used to come back empty.

    ``--format=value(account)`` prints bare values, one per line, with no
    header; the filter leaves at most one. `.splitlines()[0]` rather than
    `.strip()` because a future gcloud that prints two would otherwise be
    concatenated into one nonsense address.
    """
    try:
        result = subprocess.run(  # noqa: S603 - fixed argv, no shell
            [
                "gcloud",
                "auth",
                "list",
                "--filter=status:ACTIVE",
                "--format=value(account)",
            ],
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines or lines[0] == "(unset)":
        return ""
    return lines[0]


def _gcloud_config_path() -> Path:
    """The active gcloud configuration file.

    ``CLOUDSDK_CONFIG`` relocates the whole SDK config directory and
    ``CLOUDSDK_ACTIVE_CONFIG_NAME`` selects between configurations; both are
    honoured because a workstation set up by someone else is exactly where they
    get used, and reading the wrong file is worse than reading none.
    """
    root = os.getenv("CLOUDSDK_CONFIG", "").strip()
    base = Path(root) if root else Path.home() / ".config" / "gcloud"
    name = os.getenv("CLOUDSDK_ACTIVE_CONFIG_NAME", "").strip() or "default"
    return base / "configurations" / f"config_{name}"


def _from_config_file(key: str) -> str:
    """Read ``[core] <key>`` out of gcloud's own configuration file.

    No subprocess. This is the probe that still works when the SDK is installed
    but not on the backend's ``PATH`` — a service started from a desktop
    launcher or a unit file does not get the ``PATH`` a login shell would, so
    both probes above fail with `FileNotFoundError` on a machine where typing
    `gcloud` in the terminal panel works fine.

    Everything here is best-effort: an unreadable, absent or malformed file
    means this layer has no answer, which is not an error.
    """
    path = _gcloud_config_path()
    parser = configparser.ConfigParser()
    try:
        if not parser.read(path, encoding="utf-8"):
            return ""
    except (OSError, UnicodeDecodeError, configparser.Error):
        return ""
    value = parser.get("core", key, fallback="").strip()
    return "" if value == "(unset)" else value


def _is_address(value: str) -> bool:
    """Whether ``value`` is an email address, which every Google account is."""
    local, at, domain = (value or "").strip().partition("@")
    return bool(
        at
        and local
        and "." in domain.strip(".")
        and not any(ch.isspace() for ch in value.strip())
    )


def _credentialed_accounts() -> list[str]:
    """Every account gcloud holds credentials for (``gcloud auth list``), or []."""
    try:
        result = subprocess.run(  # noqa: S603 - fixed argv, no shell
            ["gcloud", "auth", "list", "--format=value(account)"],
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    return [
        line.strip()
        for line in result.stdout.splitlines()
        if line.strip() and line.strip() != "(unset)"
    ]


def _adc_identity() -> tuple[str, str, str]:
    """Whose the application-default credentials are: (email, kind, problem).

    These are what the aa-* tools (google-cloud-storage, gcsfs) upload with,
    whatever gcloud's own account setting says. kind: "user", "service
    account" or "workstation" (the VM's service account, from the metadata
    server). problem: "none" (no credentials), "expired" (they can't be
    refreshed), or a short reason the email couldn't be learned; "" if fine.
    """
    try:
        import google.auth
        import google.auth.exceptions
        import google.auth.transport.requests
    except ImportError:
        return "", "", "google-auth is not installed in this environment"
    try:
        credentials, _project = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
    except google.auth.exceptions.DefaultCredentialsError:
        return "", "", "none"
    module = type(credentials).__module__
    kind = (
        "workstation"
        if "compute_engine" in module
        else "service account"
        if "service_account" in module
        else "user"
    )
    try:
        credentials.refresh(google.auth.transport.requests.Request())
    except google.auth.exceptions.RefreshError as exc:
        return "", kind, f"expired: {str(exc)[:160]}"
    except Exception as exc:  # noqa: BLE001 - network, DNS: reported, not raised
        return "", kind, f"Google couldn't be reached: {str(exc)[:160]}"
    email = getattr(credentials, "service_account_email", "") or ""
    if email and email != "default":
        return email, kind, ""
    try:
        import requests

        answer = requests.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"access_token": credentials.token},
            timeout=_CHECK_TIMEOUT,
        )
        email = (answer.json() or {}).get("email", "") if answer.ok else ""
    except Exception as exc:  # noqa: BLE001
        return "", kind, f"Google couldn't say whose they are: {str(exc)[:160]}"
    if not email:
        return "", kind, "Google didn't say whose they are"
    return email, kind, ""


def _from_adc() -> str:
    """The user account the application-default credentials belong to, or ""."""
    email, kind, problem = _adc_identity()
    return email if kind == "user" and not problem and _is_address(email) else ""


def _from_metadata(path: str = "instance/service-accounts/default/email") -> str:
    """Ask the metadata server, or "" when there isn't one."""
    request = urllib.request.Request(
        _METADATA_ROOT + path, headers={"Metadata-Flavor": "Google"}
    )
    try:
        with urllib.request.urlopen(request, timeout=_PROBE_TIMEOUT) as response:
            return response.read().decode("utf-8").strip()
    except (urllib.error.URLError, OSError, ValueError):
        return ""


#: (principal, source), resolved once. Cleared by `?refresh=true`.
_cached: tuple[str, str] | None = None

#: Why candidates were passed over in the last detection, and how the one
#: chosen was found when that needs saying; for the account check.
_passed_over: list[str] = []
_chosen_note: str = ""

#: The project id, resolved once. Separate from `_cached` because it has its own
#: sources and one can be known while the other is not.
_cached_project: str | None = None

#: Last resort for the project id: none. The project the Workbench works in is
#: the one this user chose (gcp.py), and the UI shows that choice, so naming a
#: project here that nobody chose would only contradict it.
_DEFAULT_PROJECT = ""

#: Project id environment variables, most specific first. Ours leads so that a
#: deployment which pins the project keeps pinning it.
_PROJECT_ENV = (
    "AALIBRARY_GCP_PROJECT_ID",
    "GOOGLE_CLOUD_PROJECT",
    "CLOUDSDK_CORE_PROJECT",
    "GCLOUD_PROJECT",
)


def detect_principal(*, refresh: bool = False) -> tuple[str, str]:
    """Resolve the active principal to (address, source).

    Ordered cheapest-and-most-explicit first: two environment reads, then two
    subprocesses, then a file, then the network. The file probe sits *after*
    the subprocesses because when `gcloud` does run it is authoritative — it
    resolves the active configuration itself rather than us guessing at which
    file that is.
    """
    global _cached, _passed_over, _chosen_note
    if _cached is not None and not refresh:
        return _cached
    passed_over: list[str] = []
    _passed_over, _chosen_note = passed_over, ""

    def usable(value: str, where: str) -> bool:
        value = (value or "").strip()
        if not value or value == "(unset)":
            return False
        if _is_address(value):
            return True
        passed_over.append(f"{where} is “{value}”, which isn't an email address")
        return False

    def found(account: str, source: str, note: str = "") -> tuple[str, str]:
        global _cached, _chosen_note
        _cached, _chosen_note = (account.strip(), source), note
        return _cached

    override = os.getenv("AASI_PRINCIPAL", "").strip()
    if override:
        return found(override, "env")

    # gcloud's own override. Honoured before probing gcloud, because that is
    # the precedence gcloud itself applies, and disagreeing with the SDK about
    # which account is active would put a name in the UI that no command run
    # from the terminal panel would use.
    override = os.getenv("CLOUDSDK_CORE_ACCOUNT", "").strip()
    if usable(override, "CLOUDSDK_CORE_ACCOUNT"):
        return found(override, "env")

    for probe, where in (
        (_from_gcloud, "gcloud's account setting"),
        (_from_gcloud_auth_list, "gcloud's active account"),
    ):
        account = probe()
        if usable(account, where):
            return found(account, "gcloud")

    # The setting named no account (or a placeholder). When gcloud holds
    # credentials for exactly one, that is who is signed in; with several,
    # choosing one would be a guess.
    if passed_over:
        held = [a for a in _credentialed_accounts() if _is_address(a)]
        if len(held) == 1:
            return found(
                held[0], "gcloud", "the one account gcloud holds credentials for"
            )
        if len(held) > 1:
            passed_over.append(
                f"gcloud holds credentials for {len(held)} accounts "
                f"({', '.join(held)}) and none is selected"
            )

    account = _from_config_file("account")
    if usable(account, "gcloud's configuration file"):
        return found(account, "gcloud")

    account = _from_adc()
    if account:
        return found(
            account, "adc", "the account of your application-default credentials"
        )

    account = _from_metadata()
    if account:
        return found(account, "metadata")

    _cached = ("", "unknown")
    return _cached


def detect_project(*, source: str = "unknown", refresh: bool = False) -> str:
    """Resolve the GCP project id.

    `source` is the principal's source, and it decides whether the metadata
    server is worth asking: on anything that is not a GCE VM or Cloud
    Workstation that probe is a two-second timeout, and the only evidence we
    have that a metadata server exists is that it already answered once. This
    endpoint is called while the shell paints its first frame, so a probe that
    is nearly always going to time out does not get to run.
    """
    global _cached_project
    # The project this user chose in the Workbench (gcp.py) is the one every
    # tool here is told to use, so it is the one to show. Not cached: it can
    # change while the server runs, and reading it is one small file.
    try:
        from .gcp import current

        chosen = current()
        if chosen.source != "unset" and chosen.project:
            return chosen.project
    except Exception:  # noqa: BLE001, S110 - fall back to what gcloud says
        pass
    if _cached_project is not None and not refresh:
        return _cached_project

    for name in _PROJECT_ENV:
        value = os.getenv(name, "").strip()
        if value:
            _cached_project = value
            return _cached_project

    # The file before the subprocess here, unlike the principal: this is the
    # same value `gcloud config get-value project` would print, and it is not
    # worth a process spawn on the startup path to read it a second way.
    for candidate in (
        _from_config_file("project"),
        _from_metadata("project/project-id") if source == "metadata" else "",
    ):
        if candidate:
            _cached_project = candidate
            return _cached_project

    _cached_project = _DEFAULT_PROJECT
    return _cached_project


def allowlist() -> list[str]:
    raw = os.getenv("AASI_PROJECT_MEMBERS", "")
    return [entry.strip().lower() for entry in raw.split(",") if entry.strip()]


def is_member(principal: str, entries: list[str]) -> bool:
    """Match a principal against the allowlist.

    An entry beginning with ``@`` is a domain and matches every address in it;
    anything else must match in full. An *unknown* principal is not a member of
    a configured allowlist — the honest reading of "we could not tell who you
    are" is not "you are on the list".
    """
    if not entries:
        return True
    if not principal:
        return False
    lowered = principal.lower()
    domain = lowered.rpartition("@")[2]
    for entry in entries:
        if entry.startswith("@"):
            if domain == entry[1:]:
                return True
        elif entry == lowered:
            return True
    return False


def _detail(principal: str, source: str, restricted: bool, member: bool) -> str:
    """The sentence the panel shows. Every branch names something actionable."""
    if _bool_env("AASI_FS_READONLY"):
        prefix = "This Workbench is read-only (AASI_FS_READONLY). "
    else:
        prefix = ""

    if not principal:
        return (
            f"{prefix}No account detected. Run `gcloud auth login` so uploads "
            f"and bucket access use a known identity."
        )
    if restricted and not member:
        return (
            f"{prefix}{principal} is not in AASI_PROJECT_MEMBERS, so project "
            f"actions are hidden here. They would still be refused by GCP if "
            f"run directly — this only stops the Workbench offering them."
        )
    if source == "metadata":
        return (
            f"{prefix}Running as the service account {principal}. Bucket "
            f"permissions are the ones granted to it, not to you."
        )
    if _passed_over:
        return (
            f"{prefix}Signed in as {principal} ({_chosen_note or 'found by gcloud'}). "
            f"{_sentence(_passed_over[0])}: open the account check to fix it."
        )
    return f"{prefix}Signed in as {principal}."


@router.get("", response_model=Identity)
def get_identity(refresh: bool = Query(default=False)) -> Identity:
    """Report the active principal and what the UI should offer them."""
    principal, source = detect_principal(refresh=refresh)
    entries = allowlist()
    restricted = bool(entries)
    member = is_member(principal, entries)

    read_only = _bool_env("AASI_FS_READONLY")
    # Non-membership gates *project* actions only. It deliberately does not
    # touch the local filesystem: whose machine this is has already been
    # answered by the fact that they are logged into it, and a colleague
    # helping at someone else's desk should not lose the file browser.
    capabilities = Capabilities(
        writeFiles=not read_only,
        trashFiles=not read_only,
        runJobs=True,
        publish=member,
    )

    return Identity(
        principal=principal,
        source=source,
        project=detect_project(source=source, refresh=refresh),
        member=member,
        restricted=restricted,
        capabilities=capabilities,
        enforced=False,
        detail=_detail(principal, source, restricted, member),
    )


# --------------------------------------------------------------------------- #
# The account check
# --------------------------------------------------------------------------- #

#: What a Prepare run needs of the chosen bucket: read what is there (reuse),
#: and write products.
_BUCKET_PERMISSIONS = (
    "storage.objects.list",
    "storage.objects.get",
    "storage.objects.create",
)

_ORDER = {"ok": 0, "unknown": 1, "warn": 2, "fail": 3}


class Check(BaseModel):
    id: str
    label: str
    #: ok | warn | fail | unknown (couldn't be answered, e.g. no network).
    state: str
    #: One or two sentences for a person, shown verbatim.
    detail: str
    #: The command that fixes it, to copy or run in the terminal; "" if none.
    fix: str = ""
    #: What running ``fix`` will do, in a few words.
    fixNote: str = ""


class AccountCheck(BaseModel):
    #: The worst of the checks.
    state: str
    #: The account the Workbench names the folder after ("" if none).
    principal: str
    #: The account the aa-* tools upload with ("" if unknown).
    uploader: str
    #: Where Prepare puts products: gs://BUCKET/derived_products/NAME/ ("" if none).
    folder: str
    checks: list[Check]


def _bucket_permissions(bucket: str) -> tuple[set[str] | None, str]:
    """The permissions on ``bucket`` that the application-default credentials
    hold, asked of GCS (testIamPermissions: nothing is read or written).
    (None, reason) when it couldn't be asked."""
    try:
        import google.auth
        import google.auth.transport.requests
    except ImportError:
        return None, "google-auth is not installed in this environment"
    try:
        credentials, _project = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        session = google.auth.transport.requests.AuthorizedSession(credentials)
        answer = session.get(
            f"https://storage.googleapis.com/storage/v1/b/{bucket}/iam/testPermissions",
            params=[("permissions", name) for name in _BUCKET_PERMISSIONS],
            timeout=_CHECK_TIMEOUT,
        )
    except Exception as exc:  # noqa: BLE001 - no credentials, no network: reported
        return None, str(exc)[:200]
    if answer.status_code == 200:
        return set((answer.json() or {}).get("permissions") or []), ""
    if answer.status_code in (403, 404):
        return set(), ""
    return None, f"GCS answered {answer.status_code}"


def _sentence(text: str) -> str:
    """``text`` as a sentence: a capital first letter, unless it starts with a
    lower-case name such as gcloud."""
    if not text or text.startswith("gcloud"):
        return text
    return text[0].upper() + text[1:]


def _account_check(principal: str, source: str) -> Check:
    if not principal:
        fix = ""
        held = [a for a in _credentialed_accounts() if _is_address(a)]
        if held:
            fix = f"gcloud config set account {held[0]}"
        return Check(
            id="account",
            label="Your Workbench account",
            state="fail",
            detail=(
                "No Google account was found to name your folder after, so Prepare "
                "won't run. "
                + (" ".join(f"{_sentence(reason)}." for reason in _passed_over))
            ).strip(),
            fix=fix or "gcloud auth login",
            fixNote="selects that account in gcloud"
            if fix
            else "signs you in to gcloud",
        )
    if source == "metadata":
        return Check(
            id="account",
            label="Your Workbench account",
            state="warn",
            detail=(
                f"Only this workstation's service account, {principal}, was found. "
                "Your folder would be named after it, not you."
            ),
            fix="gcloud auth login",
            fixNote="signs you in to gcloud as yourself",
        )
    if _passed_over:
        reasons = " ".join(f"{_sentence(reason)}." for reason in _passed_over)
        placeholder = any("“ACCOUNT”" in reason for reason in _passed_over)
        return Check(
            id="account",
            label="Your Workbench account",
            state="warn",
            detail=(
                f"{reasons} "
                + (
                    "(Google's instructions write `gcloud config set account ACCOUNT` "
                    "with ACCOUNT standing for your address.) "
                    if placeholder
                    else ""
                )
                + f"The Workbench uses {principal}, "
                f"{_chosen_note or 'found by gcloud'}."
            ),
            fix=f"gcloud config set account {principal}",
            fixNote="makes gcloud's setting say so too",
        )
    how = {
        "env": "set in this Workbench's environment",
        "adc": "your application-default credentials' account",
    }.get(source, "from gcloud")
    return Check(
        id="account",
        label="Your Workbench account",
        state="ok",
        detail=f"{principal} ({how}).",
    )


def _upload_check(principal: str) -> tuple[Check, str]:
    email, kind, problem = _adc_identity()
    login = "gcloud auth application-default login"
    if problem == "none":
        return Check(
            id="uploads",
            label="The account uploads use",
            state="fail",
            detail=(
                "There are no application-default credentials, so the aa-* tools "
                "can't reach the bucket."
            ),
            fix=login,
            fixNote="signs the aa-* tools in as you",
        ), ""
    if problem.startswith("expired"):
        return Check(
            id="uploads",
            label="The account uploads use",
            state="fail",
            detail=(
                "The application-default credentials can't be renewed (expired or "
                f"revoked), so uploads will be refused. {problem[len('expired: ') :]}"
            ).strip(),
            fix=login,
            fixNote="signs the aa-* tools in again",
        ), ""
    if problem:
        return Check(
            id="uploads",
            label="The account uploads use",
            state="unknown",
            detail=(
                "The aa-* tools upload with your application-default "
                f"credentials; {problem}."
            ),
        ), ""
    whose = {
        "workstation": f"this workstation's service account, {email}",
        "service account": f"the service account {email}",
    }.get(kind, email)
    if principal and email.lower() != principal.lower():
        return Check(
            id="uploads",
            label="The account uploads use",
            state="warn",
            detail=(
                f"Uploads are made as {whose}, but your folder is named after "
                f"{principal}. Products land in {principal.split('@')[0]}'s folder "
                f"with {email.split('@')[0]}'s permissions."
            ),
            fix=login,
            fixNote=f"signs the aa-* tools in (choose {principal})",
        ), email
    return Check(
        id="uploads",
        label="The account uploads use",
        state="ok",
        detail=f"Uploads are made as {whose}.",
    ), email


def _bucket_check(bucket: str, uploader: str, uploads: Check | None = None) -> Check:
    if not bucket:
        return Check(
            id="bucket",
            label="The bucket",
            state="warn",
            detail=(
                "No bucket is chosen yet: choose a GCP project and bucket (the project "
                "in the status bar)."
            ),
        )
    if uploads is not None and uploads.state == "fail":
        return Check(
            id="bucket",
            label=f"gs://{bucket}",
            state="unknown",
            detail=(
                "Can't be checked until the application-default credentials above "
                "are set up."
            ),
        )
    held, problem = _bucket_permissions(bucket)
    who = uploader or "your application-default credentials"
    if held is None:
        return Check(
            id="bucket",
            label=f"gs://{bucket}",
            state="unknown",
            detail=f"Couldn't ask GCS what {who} may do there: {problem}",
        )
    can_read = {"storage.objects.list", "storage.objects.get"} <= held
    if can_read and "storage.objects.create" in held:
        return Check(
            id="bucket",
            label=f"gs://{bucket}",
            state="ok",
            detail=f"{who} can read and write it.",
        )
    if can_read:
        return Check(
            id="bucket",
            label=f"gs://{bucket}",
            state="warn",
            detail=(
                f"{who} can read it but not write to it, so Prepare can't publish "
                "products. Ask the bucket's administrator for write access."
            ),
        )
    return Check(
        id="bucket",
        label=f"gs://{bucket}",
        state="fail",
        detail=(
            f"{who} has no access to it. Ask the bucket's administrator, or check "
            "the account above is the right one."
        ),
    )


@router.get("/check", response_model=AccountCheck)
def get_account_check(refresh: bool = Query(default=True)) -> AccountCheck:
    """Who the Workbench is, who uploads, and what the bucket allows — with fixes.

    Read-only throughout: gcloud is asked, Google is asked whose the
    application-default credentials are, and GCS is asked which permissions
    they hold on the chosen bucket (testIamPermissions). Nothing is written.
    """
    principal, source = detect_principal(refresh=refresh)
    from .baseline import _clean_segment, default_bucket

    try:
        bucket = default_bucket()
    except Exception:  # noqa: BLE001 - no project chosen yet
        bucket = ""
    account = _account_check(principal, source)
    uploads, uploader = _upload_check(principal)
    checks = [account, uploads, _bucket_check(bucket, uploader, uploads)]
    local = principal.split("@", 1)[0] if principal else ""
    folder = (
        f"gs://{bucket}/derived_products/{_clean_segment(local)}/"
        if local and bucket
        else ""
    )
    if folder:
        account.detail += f" Your products go to {folder}"
    state = max((check.state for check in checks), key=lambda s: _ORDER.get(s, 1))
    return AccountCheck(
        state=state,
        principal=principal,
        uploader=uploader,
        folder=folder,
        checks=checks,
    )
