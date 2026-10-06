"""The dataflow around a product: what it was made from, what was made from it.

Echoview shows a variable's dataflow and recomputes what depends on a line
when the line is edited. Here every product records its inputs (by their
identity: the product hash, or a source file's checksum) in its
``<product>.aa.json``, so the same graph is read from the bucket:

* **Up**: the product's inputs, and theirs, through their records (the raw
  files at the root, the EchoData, the Sv, a line file, an ECS).
* **Down**: the products in the same folders whose records name it as an
  input, and theirs.
* **Out of date**: a product made with a line, region or calibration file
  when a newer file of the same name (the same line, edited and saved again)
  is in the folder; and everything made from it. The hashes make this exact:
  remaking it with the new file gives a different product, never a stale one
  reused.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import products

router = APIRouter(prefix="/api/lineage", tags=["lineage"])

MAX_UP = 12
MAX_FOLDER = 300
EDITABLE_ROLES = ("lines", "regions", "calibration")


class Node(BaseModel):
    id: str
    uri: str = ""
    name: str = ""
    kind: str = ""
    level: str = ""
    tool: str = ""
    productHash: str = ""
    createdAt: str = ""
    createdBy: str = ""
    #: self | up (made it) | down (made from it)
    relation: Literal["self", "up", "down"] = "up"
    #: Short label of the step that made it ("aa-sv").
    stale: bool = False
    staleReason: str = ""
    inBucket: bool = True


class Edge(BaseModel):
    source: str
    target: str
    role: str = "source"


class Graph(BaseModel):
    uri: str
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    folders: list[str] = Field(default_factory=list)
    truncated: bool = False


class _Record:
    def __init__(self, uri: str, doc: dict | None, entry=None):
        self.uri = uri
        self.doc = doc or {}
        product = self.doc.get("product") or {}
        self.hash = str(product.get("hash") or getattr(entry, "productHash", "") or "")
        self.kind = products.kind_of(
            str(getattr(entry, "tool", "") or ""),
            uri.rsplit("/", 1)[-1],
            str(product.get("kind") or ""),
        )
        pipeline = self.doc.get("pipeline") or []
        self.tool = (
            str((pipeline[-1] or {}).get("tool", ""))
            if pipeline
            else str(getattr(entry, "tool", "") or "")
        )
        self.inputs = [i for i in self.doc.get("inputs") or [] if isinstance(i, dict)]
        created = self.doc.get("created") or {}
        self.created = str(created.get("at") or "")
        self.user = str(created.get("user") or "")
        self.extra = self.doc.get("extra") or {}
        self.base = str(self.doc.get("base") or getattr(entry, "base", "") or "")

    @property
    def ident(self) -> str:
        return "aa:" + self.hash if self.hash else ""


def _record(uri: str, entry=None) -> _Record:
    try:
        doc = products.read_record(uri)
    except HTTPException:
        doc = None
    return _Record(uri, doc, entry)


def _node(rec: _Record, relation: str) -> Node:
    from .catalogue import LEVELS

    return Node(
        id=rec.uri,
        uri=rec.uri,
        name=rec.uri.rsplit("/", 1)[-1],
        kind=rec.kind,
        level=LEVELS.get(rec.kind, ""),
        tool=rec.tool,
        productHash=rec.hash,
        createdAt=rec.created,
        createdBy=rec.user,
        relation=relation,  # type: ignore[arg-type]
    )


def _family(rec: _Record) -> tuple[str, str, str] | None:
    """(kind, base, name) of an editable input: the same line saved again shares
    it. The base keeps apart files of the same name made for different data
    (a "bottom" for each file of a survey, an ECS labelled "cal" for each)."""
    if rec.kind not in EDITABLE_ROLES:
        return None
    name = str(rec.extra.get("name") or rec.extra.get("label") or "")
    if not name:
        stem = rec.uri.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        name = stem.rsplit("_", 1)[0]
    return rec.kind, rec.base, name


def _exists(uri: str) -> bool:
    """In the bucket; False for one a record names that cannot be read (a
    malformed URI must not fail the whole graph)."""
    try:
        return products.info(uri, history=False).found
    except HTTPException:
        return False


def graph(uri: str) -> Graph:
    from .echogram import _destination

    me = products.info(uri)
    if not me.found:
        raise HTTPException(
            status_code=404, detail=me.detail or f"{uri} is not in the bucket."
        )
    out = Graph(uri=me.uri)
    nodes: dict[str, Node] = {}
    records: dict[str, _Record] = {}

    root = _record(me.uri)
    records[me.uri] = root
    nodes[me.uri] = _node(root, "self")

    # Up: through each input's record.
    frontier = [root]
    hops = 0
    while frontier and hops < MAX_UP:
        hops += 1
        nxt = []
        for rec in frontier:
            for inp in rec.inputs:
                source = str(inp.get("uri") or "")
                role = str(inp.get("role") or "source")
                if source.startswith("gs://"):
                    if source not in records:
                        parent = _record(source)
                        records[source] = parent
                        nodes[source] = _node(parent, "up")
                        nodes[source].inBucket = bool(parent.doc) or _exists(source)
                        nxt.append(parent)
                    out.edges.append(Edge(source=source, target=rec.uri, role=role))
                else:
                    key = "id:" + str(inp.get("id") or source or inp.get("name"))
                    if key not in nodes:
                        nodes[key] = Node(
                            id=key,
                            uri=source,
                            name=str(inp.get("name") or source or key),
                            kind="raw"
                            if str(inp.get("name", "")).lower().endswith(".raw")
                            else "",
                            relation="up",
                            inBucket=False,
                        )
                    out.edges.append(Edge(source=key, target=rec.uri, role=role))
        frontier = nxt

    # Down: the folders where products made from it live.
    folders = list(
        dict.fromkeys(
            [products.folder_of(me.uri), *([d] if (d := _destination(me.uri)) else [])]
        )
    )
    out.folders = folders
    entries = []
    for folder in folders:
        entries.extend(products.folder_entries(folder, limit=MAX_FOLDER))
    entries = [e for e in entries if not e.name.endswith(".aa.json")]
    if len(entries) > MAX_FOLDER:
        out.truncated = True
        entries = entries[:MAX_FOLDER]
    todo = [e for e in entries if e.uri not in records]
    with ThreadPoolExecutor(max_workers=12) as pool:
        for rec in pool.map(lambda e: _record(e.uri, e), todo):
            records[rec.uri] = rec
    by_ident = {r.ident: r for r in records.values() if r.ident}
    children: dict[str, list[tuple[_Record, str]]] = {}
    for rec in records.values():
        for inp in rec.inputs:
            parent = by_ident.get(str(inp.get("id") or ""))
            if parent is None and str(inp.get("uri") or "") in records:
                parent = records[str(inp.get("uri"))]
            if parent is not None and parent.uri != rec.uri:
                children.setdefault(parent.uri, []).append(
                    (rec, str(inp.get("role") or ""))
                )
    stack = [me.uri]
    seen = {me.uri}
    while stack:
        current = stack.pop()
        for child, role in children.get(current, []):
            if child.uri not in nodes:
                nodes[child.uri] = _node(child, "down")
            if not any(
                e.source == current and e.target == child.uri for e in out.edges
            ):
                out.edges.append(
                    Edge(source=current, target=child.uri, role=role or "source")
                )
            if child.uri not in seen:
                seen.add(child.uri)
                stack.append(child.uri)

    # Out of date: made with an editable file that has a newer version.
    newest: dict[tuple[str, str, str], _Record] = {}
    for rec in records.values():
        fam = _family(rec)
        if fam and (fam not in newest or rec.created > newest[fam].created):
            newest[fam] = rec
    for node_id, node in nodes.items():
        rec = records.get(node_id)
        if rec is None:
            continue
        for inp in rec.inputs:
            used = by_ident.get(str(inp.get("id") or "")) or records.get(
                str(inp.get("uri") or "")
            )
            fam = _family(used) if used is not None else None
            if (
                fam
                and newest[fam].uri != used.uri
                and newest[fam].created > used.created
            ):
                node.stale = True
                node.staleReason = (
                    f"Made with {used.uri.rsplit('/', 1)[-1]}; {fam[0]} '{fam[2]}' "
                    "was saved "
                    f"again since ({newest[fam].uri.rsplit('/', 1)[-1]})."
                )
    changed = True
    while changed:
        changed = False
        for edge in out.edges:
            src, dst = nodes.get(edge.source), nodes.get(edge.target)
            if src and dst and src.stale and not dst.stale:
                dst.stale = True
                dst.staleReason = f"Made from {src.name}, which is out of date."
                changed = True

    out.nodes = list(nodes.values())
    return out


@router.get("", response_model=Graph)
def get_graph(uri: str = Query(..., min_length=6)) -> Graph:
    return graph(uri)
