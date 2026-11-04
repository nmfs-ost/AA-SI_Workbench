"""Prepare requests sent to this Workbench by other apps, over HTTPS.

Another Google Cloud app (a metadata manager, say) can ask the Workbench on a
chosen workstation to prepare a survey's time range: EchoData and Sv, as in
the Prepare EchoData panel. It sends a small card:

    POST https://<port>-<workstation host>/api/remote/prepare
    X-AA-Identity: <a Google ID token for the caller, audience: this address>
    {"vessel": "Henry_B._Bigelow", "survey": "HB1603", "sonar": "EK60",
     "start": "2016-07-03T06:00:00", "end": "2016-07-03T12:00:00"}

and gets back the request's id, and whether it started or is waiting for the
workstation's user. ``GET /api/remote/requests/<id>`` (same header) follows it.

Who may: the caller's identity comes from the ID token, which Google signs
and this checks (signature, expiry, audience, a verified email). The user of
this workstation lists the accounts that may start a run (Account menu >
Remote requests). A request from any other account is held, not run, until
the user runs it, allows the account or discards it. Remote requests are off
until the user turns them on. A run started this way is the user's own: their
account, their folder, their costs, exactly as if they had pressed Prepare.

Only Prepare requests are taken, with this Workbench's built-in tools; a card
can't choose the bucket (the products go to the user's own folder in the
workstation's bucket), name a working folder on this machine, keep files on
it, or carry commands of its own. The token's audience is this workstation's
own address, so a token made for one workstation is no use on another.

Reaching the endpoint at all is Cloud Workstations' gateway: the caller needs
access to this workstation (and the workstation must be running, with the
Workbench serving). That access opens all of the Workbench, not only this
endpoint, so give it only to accounts you would trust with the workstation.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

router = APIRouter(prefix="/api/remote", tags=["remote"])

#: The audience callers ask Google for when they make their ID token, off a
#: workstation (on one it's the workstation's own address: see audience()).
DEFAULT_AUDIENCE = "aa-si-workbench"
#: The client ID of the gcloud CLI: a person's own `gcloud auth
#: print-identity-token` has this audience (it can't choose another).
GCLOUD_AUDIENCE = "32555940559.apps.googleusercontent.com"
#: How many decided requests the log keeps (waiting ones are always kept).
KEEP = 200
#: How many may wait for the user at once.
MAX_HELD = 50

_lock = threading.RLock()
_log = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class RemoteCard(BaseModel):
    """What a caller sends: which data, and which products. Names are the
    source's own, as the Prepare panel lists them (e.g. NCEI's
    "Henry_B._Bigelow")."""

    #: Unknown fields are refused, so a misspelt option (or one a card can't
    #: set, like the bucket) is an error, not silently ignored.
    model_config = ConfigDict(extra="forbid")

    source: str = Field(default="ncei", min_length=1, max_length=100)
    vessel: str = Field(min_length=1, max_length=200)
    survey: str = Field(min_length=1, max_length=200)
    sonar: str = Field(min_length=1, max_length=100)
    #: UTC, ISO 8601 ("2016-07-03T06:00:00").
    start: str = Field(min_length=1, max_length=40)
    end: str = Field(min_length=1, max_length=40)
    #: File by file into the bucket (each raw file its own Zarr store, then
    #: joined there). Off: fetched to this machine and combined here.
    streamed: bool = True
    format: Literal["nc", "zarr"] = "zarr"
    sv: bool = True
    echogram: bool = True
    base: str = Field(default="", max_length=200)
    gapSeconds: float = Field(default=900, gt=0, allow_inf_nan=False)
    gapFactor: float = Field(default=6, gt=0, allow_inf_nan=False)
    waveformMode: Literal["CW", "BB"] = "CW"
    encodeMode: Literal["complex", "power"] = "complex"
    #: Shown to the workstation's user beside the request.
    note: str = Field(default="", max_length=500)


class RemoteSettings(BaseModel):
    enabled: bool = False
    #: Accounts (email addresses) whose requests start at once.
    accounts: list[str] = Field(default_factory=list)
    #: Also accept a person's own gcloud ID token (testing from a terminal).
    acceptGcloudTokens: bool = False


class RemoteRequest(BaseModel):
    id: str
    receivedAt: str
    caller: str
    #: started | held | starting | refused | discarded
    status: str
    detail: str = ""
    card: RemoteCard
    runId: str = ""
    base: str = ""
    destination: str = ""
    decidedAt: str = ""


class RemoteState(BaseModel):
    settings: RemoteSettings
    #: The address callers use (https://<port>-<host>/), '' off a workstation.
    url: str = ""
    audience: str = DEFAULT_AUDIENCE
    requests: list[RemoteRequest] = Field(default_factory=list)


class RemoteAnswer(BaseModel):
    """What the caller gets back."""

    id: str
    status: str
    detail: str = ""
    runId: str = ""
    destination: str = ""
    #: The run's state when it started: running | succeeded | failed | cancelled.
    runState: str = ""


# --------------------------------------------------------------------------- #
# Storage (the Workbench's config folder)
# --------------------------------------------------------------------------- #
def _dir() -> Path:
    from .gcp import config_dir

    return config_dir()


def _read(name: str, default):
    path = _dir() / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _write(name: str, data) -> None:
    folder = _dir()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    temp = path.with_name(f".{name}.{os.getpid()}.tmp")
    temp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(temp, path)


def settings() -> RemoteSettings:
    with _lock:
        try:
            return RemoteSettings(**_read("remote.json", {}))
        except (TypeError, ValueError):
            return RemoteSettings()


def _save_settings(value: RemoteSettings) -> None:
    with _lock:
        _write("remote.json", value.model_dump())


def _requests() -> list[RemoteRequest]:
    with _lock:
        out = []
        for item in _read("remote-requests.json", []):
            try:
                out.append(RemoteRequest(**item))
            except (TypeError, ValueError):
                continue
        return out


def _save_requests(items: list[RemoteRequest]) -> None:
    with _lock:
        decided = {r.id for r in [r for r in items if r.status != "held"][-KEEP:]}
        kept = [r for r in items if r.status == "held" or r.id in decided]
        _write("remote-requests.json", [r.model_dump() for r in kept])


def _record(item: RemoteRequest) -> RemoteRequest:
    with _lock:
        items = [r for r in _requests() if r.id != item.id]
        items.append(item)
        _save_requests(items)
    return item


def _find(request_id: str) -> RemoteRequest:
    for item in _requests():
        if item.id == request_id:
            return item
    raise HTTPException(status_code=404, detail="No such request.")


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize(email: str) -> str:
    return email.strip().lower()


# --------------------------------------------------------------------------- #
# Who is calling
# --------------------------------------------------------------------------- #
def verify(token: str, audiences: list[str]) -> dict:
    """The claims of a Google-signed ID token for one of `audiences`.
    Raises ValueError when it isn't one (or can't be checked)."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    claims = id_token.verify_token(token, google_requests.Request(), audience=audiences)
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("not issued by Google")
    return claims


def _token_of(identity: str | None, authorization: str | None) -> str:
    if identity and identity.strip():
        return identity.strip()
    # Cloud Workstations' gateway takes its own token in Authorization; a
    # caller that reaches the Workbench another way may put the ID token there.
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def audience() -> str:
    """The audience a caller's ID token must have: this workstation's own
    address (so a token made for one workstation is no use on another), or
    DEFAULT_AUDIENCE off a workstation."""
    from .address import address

    url = address().url
    return url.rstrip("/") if url else DEFAULT_AUDIENCE


def caller(identity: str | None, authorization: str | None) -> str:
    """The verified email of the caller, or an HTTP 401."""
    token = _token_of(identity, authorization)
    if not token:
        raise HTTPException(
            status_code=401,
            detail=(
                "No identity: send a Google ID token for your account in the "
                f"X-AA-Identity header (audience {audience()!r})."
            ),
        )
    audiences = [audience()]
    if settings().acceptGcloudTokens:
        audiences.append(GCLOUD_AUDIENCE)
    try:
        claims = verify(token, audiences)
    except Exception as exc:  # noqa: BLE001 - any failure: not proven
        _log.info("Remote request: identity token refused: %s", exc)
        raise HTTPException(
            status_code=401,
            detail=(
                "The identity token was not accepted: it must be a current Google "
                f"ID token with audience {audience()!r}."
            ),
        ) from exc
    email = _normalize(str(claims.get("email") or ""))
    if not email or claims.get("email_verified") not in (True, "true"):
        raise HTTPException(
            status_code=401,
            detail=(
                "The identity token has no verified email. A service account's "
                "token needs it: --include-email with gcloud, format=full from "
                "the metadata server."
            ),
        )
    return email


# --------------------------------------------------------------------------- #
# A card -> the Prepare request
# --------------------------------------------------------------------------- #
_DEFAULT_GAP_SECONDS = 900
_DEFAULT_GAP_FACTOR = 6
_LONE_FILE_SECONDS = 20 * 60


def _epoch(value: str) -> float:
    text = str(value).strip().replace(" ", "T")
    if text.endswith(("Z", "z")):
        text = text[:-1]
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.timestamp()


def _tool_time(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, UTC).strftime("%Y-%m-%dT%H:%M:%S")


def _fetch_end(last: float) -> str:
    """aa-request reads 00:00:00 as the whole day: one second later instead
    (mirrors fetchEnd in the Prepare panel's plan.ts)."""
    at = datetime.fromtimestamp(last, UTC)
    midnight = at.hour == 0 and at.minute == 0 and at.second == 0
    return _tool_time(last + 1 if midnight else last)


def plan_range(files: list, start: float, end: float) -> dict | None:
    """The raw files that cover [start, end), and the window that fetches
    exactly them: the Prepare panel's planRange (plan.ts), here so a card
    needs only a time range. None when nothing covers it."""
    if not end > start:
        return None
    dated = []
    for item in files:
        try:
            dated.append((_epoch(item.acquiredAt), item))
        except (TypeError, ValueError):
            continue
    dated.sort(key=lambda pair: pair[0])
    intervals = sorted(b[0] - a[0] for a, b in zip(dated, dated[1:], strict=False))
    if intervals:
        mid = len(intervals) // 2
        cadence = (
            intervals[mid]
            if len(intervals) % 2
            else (intervals[mid - 1] + intervals[mid]) / 2
        )
    else:
        cadence = 0
    typical = cadence or _LONE_FILE_SECONDS
    chosen = []
    for index, (begin, item) in enumerate(dated):
        following = dated[index + 1][0] if index + 1 < len(dated) else None
        finish = (
            min(following, begin + typical * 1.5)
            if following is not None
            else begin + typical
        )
        interval = following - begin if following is not None else float("inf")
        gap = (
            interval - typical >= _DEFAULT_GAP_SECONDS
            and interval >= typical * _DEFAULT_GAP_FACTOR
        )
        reach = following if following is not None and not gap else finish
        if begin < end and reach > start:
            chosen.append((begin, item))
    if not chosen:
        return None
    first, last = chosen[0][0], chosen[-1][0]
    return {
        "files": [item.name for _, item in chosen],
        "bytes": sum(int(item.sizeBytes or 0) for _, item in chosen),
        "largest": max(int(item.sizeBytes or 0) for _, item in chosen),
        "fetchFrom": _tool_time(first),
        "fetchTo": _fetch_end(last + 1 if last == first else last),
    }


def _times(card: RemoteCard) -> tuple[float, float]:
    """The card's start and end (epoch seconds), or an HTTP 400."""
    try:
        start, end = _epoch(card.start), _epoch(card.end)
        _tool_time(start), _tool_time(end)
    except (ValueError, OverflowError, OSError) as exc:
        raise HTTPException(
            status_code=400,
            detail="start and end must be UTC date-times, e.g. 2016-07-03T06:00:00.",
        ) from exc
    if not end > start:
        raise HTTPException(status_code=400, detail="end must be after start.")
    return start, end


def request_for(card: RemoteCard):
    """The Prepare request a card stands for (the files listed from its source
    now). HTTP 400/409 when it can't be made."""
    from . import sources
    from .baseline import BaselineRequest

    start, end = _times(card)
    listed = sources.files(card.source, card.vessel, card.survey, card.sonar)
    plan = plan_range(list(listed), start, end)
    if plan is None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"No {card.sonar} files of {card.vessel} {card.survey} cover "
                f"{card.start} to {card.end} (the range is in a gap, or outside the "
                "survey)."
            ),
        )
    return BaselineRequest(
        source=card.source,
        vessel=card.vessel,
        survey=card.survey,
        sonar=card.sonar,
        start=_tool_time(start),
        end=_tool_time(end),
        fetchFrom=plan["fetchFrom"],
        fetchTo=plan["fetchTo"],
        expectedFiles=plan["files"],
        base=card.base.strip(),
        bucket="",  # the workstation's own: never the caller's choice
        prefix="",
        format="zarr" if card.streamed else card.format,
        sv=card.sv,
        echogram=card.sv and card.echogram,
        gapSeconds=card.gapSeconds,
        gapFactor=card.gapFactor,
        strict=False,
        keepLocal=False,
        waveformMode=card.waveformMode,
        encodeMode=card.encodeMode,
        workRoot="",
        freeAsYouGo=True,
        expectedBytes=plan["bytes"],
        largestBytes=plan["largest"],
        streamed=card.streamed,
    )


def _start(item: RemoteRequest) -> RemoteRequest:
    """Run a request's card as a Prepare run; the outcome is recorded."""
    from .baseline import post_run

    try:
        run = post_run(request_for(item.card))
    except HTTPException as exc:
        item.status = "refused"
        item.detail = str(exc.detail)
        return _record(item)
    item.status = "started"
    item.runId = run.id
    item.base = run.base
    item.destination = run.destination
    item.detail = ""
    return _record(item)


def _answer(item: RemoteRequest) -> RemoteAnswer:
    state = ""
    if item.runId:
        from .baseline import get_run

        try:
            state = get_run(item.runId).state
        except HTTPException:
            state = "unknown (the Workbench was restarted since)"
    return RemoteAnswer(
        id=item.id,
        status=item.status,
        detail=item.detail,
        runId=item.runId,
        destination=item.destination,
        runState=state,
    )


# --------------------------------------------------------------------------- #
# Routes for callers (an ID token)
# --------------------------------------------------------------------------- #
def _card(body) -> RemoteCard:
    """The card in a request body, or an HTTP 422 that says what's wrong
    (without echoing the values back)."""
    try:
        return RemoteCard.model_validate(body)
    except ValidationError as exc:
        problems = [
            {
                "field": ".".join(str(part) for part in error["loc"]),
                "problem": error["msg"],
            }
            for error in exc.errors()
        ]
        raise HTTPException(status_code=422, detail=problems) from exc


@router.post(
    "/prepare",
    response_model=RemoteAnswer,
    status_code=202,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": RemoteCard.model_json_schema()}},
        }
    },
)
def post_prepare(
    body: Annotated[Any, Body()] = None,
    x_aa_identity: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    current = settings()
    if not current.enabled:
        raise HTTPException(
            status_code=403,
            detail="Remote requests are switched off on this workstation.",
        )
    who = caller(x_aa_identity, authorization)
    card = _card(body)
    _times(card)
    item = RemoteRequest(
        id=uuid.uuid4().hex[:12],
        receivedAt=_now(),
        caller=who,
        status="held",
        card=card,
    )
    if who not in {_normalize(a) for a in current.accounts}:
        with _lock:
            if sum(1 for r in _requests() if r.status == "held") >= MAX_HELD:
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests are already waiting for this "
                    "workstation's user.",
                )
            item.detail = (
                f"{who} isn't on this workstation's list of accounts that may "
                "start runs; the request waits for its user to run it."
            )
            _record(item)
        return _answer(item)
    item = _start(item)
    if item.status == "refused":
        return JSONResponse(status_code=409, content=_answer(item).model_dump())
    return _answer(item)


@router.get("/requests/{request_id}", response_model=RemoteAnswer)
def get_request(
    request_id: str,
    x_aa_identity: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> RemoteAnswer:
    who = caller(x_aa_identity, authorization)
    item = _find(request_id)
    if item.caller != who:
        raise HTTPException(status_code=404, detail="No such request.")
    return _answer(item)


# --------------------------------------------------------------------------- #
# Routes for this Workbench's user (the Remote requests dialog)
# --------------------------------------------------------------------------- #
def _json_only(request: Request) -> None:
    """The dialog's changes come as JSON. A page on another site can't send
    that without the browser asking first (CORS), and the Workbench only
    answers yes to its own pages; a plain form post is refused here."""
    kind = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if kind != "application/json":
        raise HTTPException(status_code=415, detail="Send JSON.")


@router.get("/state", response_model=RemoteState)
def get_state() -> RemoteState:
    from .address import address

    items = list(reversed(_requests()))
    return RemoteState(
        settings=settings(), url=address().url, audience=audience(), requests=items
    )


@router.post(
    "/settings", response_model=RemoteState, dependencies=[Depends(_json_only)]
)
def post_settings(value: RemoteSettings) -> RemoteState:
    accounts = []
    for account in value.accounts:
        email = _normalize(account)
        if not email:
            continue
        if "@" not in email or " " in email:
            raise HTTPException(
                status_code=400, detail=f"Not an email address: {account!r}"
            )
        if email not in accounts:
            accounts.append(email)
    _save_settings(
        RemoteSettings(
            enabled=value.enabled,
            accounts=accounts,
            acceptGcloudTokens=value.acceptGcloudTokens,
        )
    )
    return get_state()


def _decide(request_id: str, status: str) -> RemoteRequest:
    """Take a waiting request out of the queue in one step (so two clicks, or
    a Run and a Discard at once, can't both act on it)."""
    with _lock:
        item = _find(request_id)
        if item.status != "held":
            raise HTTPException(
                status_code=409, detail=f"This request is {item.status}."
            )
        item.status = status
        item.decidedAt = _now()
        return _record(item)


@router.post(
    "/requests/{request_id}/run",
    response_model=RemoteRequest,
    dependencies=[Depends(_json_only)],
)
def run_held(request_id: str) -> RemoteRequest:
    return _start(_decide(request_id, "starting"))


@router.post(
    "/requests/{request_id}/allow",
    response_model=RemoteRequest,
    dependencies=[Depends(_json_only)],
)
def allow_and_run(request_id: str) -> RemoteRequest:
    item = _decide(request_id, "starting")
    with _lock:
        current = settings()
        if item.caller not in {_normalize(a) for a in current.accounts}:
            current.accounts.append(item.caller)
            _save_settings(current)
    return _start(item)


@router.post(
    "/requests/{request_id}/discard",
    response_model=RemoteRequest,
    dependencies=[Depends(_json_only)],
)
def discard(request_id: str) -> RemoteRequest:
    return _decide(request_id, "discarded")
