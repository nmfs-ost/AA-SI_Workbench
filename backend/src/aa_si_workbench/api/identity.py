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

#: The project id, resolved once. Separate from `_cached` because it has its own
#: sources and one can be known while the other is not.
_cached_project: str | None = None

#: Last resort for the project id. A real value rather than "" because the
#: Workbench has always shown this one and a blank chip where a project used to
#: be reads as breakage; it is the *last* thing tried, so any workstation that
#: can answer for itself does.
_DEFAULT_PROJECT = "ggn-nmfs-aa-dev-1"

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
    global _cached
    if _cached is not None and not refresh:
        return _cached

    override = os.getenv("AASI_PRINCIPAL", "").strip()
    if override:
        _cached = (override, "env")
        return _cached

    # gcloud's own override. Honoured before probing gcloud, because that is
    # the precedence gcloud itself applies, and disagreeing with the SDK about
    # which account is active would put a name in the UI that no command run
    # from the terminal panel would use.
    override = os.getenv("CLOUDSDK_CORE_ACCOUNT", "").strip()
    if override and override != "(unset)":
        _cached = (override, "env")
        return _cached

    for probe in (_from_gcloud, _from_gcloud_auth_list):
        account = probe()
        if account:
            _cached = (account, "gcloud")
            return _cached

    account = _from_config_file("account")
    if account:
        _cached = (account, "gcloud")
        return _cached

    account = _from_metadata()
    if account:
        _cached = (account, "metadata")
        return _cached

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

