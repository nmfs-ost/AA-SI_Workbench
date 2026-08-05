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

Detection order is env var, then ``gcloud config get-value account``, then the
GCE/Cloud Workstation metadata server. Each is tried once per process and the
answer cached, because two of the three are slow enough to be felt on a panel
that renders at startup.
"""

from __future__ import annotations

import os
import subprocess
import urllib.error
import urllib.request

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/identity", tags=["identity"])

#: Where the metadata server answers, on a Cloud Workstation or GCE VM.
_METADATA_URL = (
    "http://metadata.google.internal/computeMetadata/v1/"
    "instance/service-accounts/default/email"
)

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


def _from_metadata() -> str:
    """The service account this VM runs as, or ""."""
    request = urllib.request.Request(
        _METADATA_URL, headers={"Metadata-Flavor": "Google"}
    )
    try:
        with urllib.request.urlopen(request, timeout=_PROBE_TIMEOUT) as response:
            return response.read().decode("utf-8").strip()
    except (urllib.error.URLError, OSError, ValueError):
        return ""


#: (principal, source), resolved once. Cleared by `?refresh=true`.
_cached: tuple[str, str] | None = None


def detect_principal(*, refresh: bool = False) -> tuple[str, str]:
    """Resolve the active principal to (address, source)."""
    global _cached
    if _cached is not None and not refresh:
        return _cached

    override = os.getenv("AASI_PRINCIPAL", "").strip()
    if override:
        _cached = (override, "env")
        return _cached

    account = _from_gcloud()
    if account:
        _cached = (account, "gcloud")
        return _cached

    account = _from_metadata()
    if account:
        _cached = (account, "metadata")
        return _cached

    _cached = ("", "unknown")
    return _cached


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
        project=os.getenv("AALIBRARY_GCP_PROJECT_ID", "ggn-nmfs-aa-dev-1"),
        member=member,
        restricted=restricted,
        capabilities=capabilities,
        enforced=False,
        detail=_detail(principal, source, restricted, member),
    )

