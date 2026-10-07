"""The address to open (and bookmark) this Workbench at.

On a Google Cloud Workstation an HTTP port is reached at

    https://<port>-<workstation>.<cluster>.cloudworkstations.dev/

and that host is the workstation's own (``$WEB_HOST``, which Cloud
Workstations sets inside the workstation): the same every time the
workstation starts, for as long as the workstation exists. A link with a
one-time ``?_workstationAccessToken=…`` on the end (Cloud Workstations' way of
signing a browser in) differs every time; the address without it is the one
to keep: opened directly, the browser signs in by a redirect.

Two more ways to a fixed address are written out here for the Workbench to
show: a tunnel from the user's own computer (``gcloud workstations
start-tcp-tunnel``), which makes it ``http://localhost:<port>`` for any
workstation; and, for a team, a custom domain or a redirect service, which
are an administrator's (docs/guides/stable-address.md).
"""

from __future__ import annotations

import os
import re

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/address", tags=["meta"])

DEFAULT_PORT = 8000
_HOST = re.compile(r"[a-z0-9][a-z0-9.-]{3,250}")


class Address(BaseModel):
    #: On a Cloud Workstation (WEB_HOST is set).
    workstation: bool
    #: The workstation's host, e.g. "aa-jane.cluster-abc.cloudworkstations.dev".
    webHost: str = ""
    #: The workstation's id (the first part of its host).
    name: str = ""
    port: int = DEFAULT_PORT
    #: The address to bookmark: https://<port>-<webHost>/ ('' off a workstation).
    url: str = ""
    #: Run on your own computer: the Workbench at http://localhost:<port>.
    tunnel: str = ""
    localUrl: str = ""


def port() -> int:
    """The port aa-workbench serves on (it publishes it as AASI_PORT)."""
    try:
        return int(os.getenv("AASI_PORT", "") or DEFAULT_PORT)
    except ValueError:
        return DEFAULT_PORT


def address() -> Address:
    host = os.getenv("WEB_HOST", "").strip().lower().rstrip("/")
    if host.startswith("https://"):
        host = host[len("https://") :]
    p = port()
    if not _HOST.fullmatch(host):
        return Address(workstation=False, port=p, localUrl=f"http://localhost:{p}")
    name = host.split(".", 1)[0]
    tunnel = (
        "gcloud workstations start-tcp-tunnel --project=PROJECT --region=REGION "
        f"--cluster=CLUSTER --config=CONFIG {name} {p} "
        f"--local-host-port=localhost:{p} --start-workstation"
    )
    return Address(
        workstation=True,
        webHost=host,
        name=name,
        port=p,
        url=f"https://{p}-{host}/",
        tunnel=tunnel,
        localUrl=f"http://localhost:{p}",
    )


@router.get("", response_model=Address)
def get_address() -> Address:
    return address()
