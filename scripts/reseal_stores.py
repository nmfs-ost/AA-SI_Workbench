"""Bring Zarr stores made before catch-up 16 up to date, in place.

    ~/venv313/bin/python reseal_stores.py gs://BUCKET/derived_products/YOU/
        looks and changes nothing;
    ~/venv313/bin/python reseal_stores.py gs://BUCKET/derived_products/YOU/ --apply
        makes the changes.

Before catch-up 16 the console tools sealed every Zarr product with a small
aa_seal group and kept its record as a JSON object. So:
  - echopype refuses to display such an EchoData (KeyError: 'aa_seal' on
    print(ed), or when a notebook shows ed): it names every group of an
    EchoData and doesn't know this one;
  - xarray can't save such a store to NetCDF
    (TypeError: Invalid value for attr 'aa_provenance').
This rewrites the small metadata objects of each such store, never its data:
  EchoData  the seal moves into its Provenance group (Provenance/zarr.json)
            and aa_seal/zarr.json is deleted;
  other     the seal (aa_seal/zarr.json) gains the store's shape;
  every     the record and markers in its root (zarr.json) become JSON text,
            and the store's own listing of itself (consolidated metadata)
            follows.
The product hash, the objects' aa- metadata and the .aa.json beside each store
are left as they are, so every store is still found and reused.

A store is changed only when all of these say it is the product its record
describes (an old seal can't tell a copy saved elsewhere from the original,
and a new seal would make the copy look genuine for good):
  - its record is sealed for it, and names this store;
  - the .aa.json beside it names the same product;
  - its root's aa-product-hash, where it has one, is the same product;
  - a store written in place says its write finished;
  - its listing of itself matches its arrays.
Each object is replaced only if it is still the version that was read, and in
an order that keeps the store its own product at every step: the new seal,
then the root, then the old seal group. Stores are done one at a time; one
that fails is reported and the rest carry on. Running it again does what is
left.

Before --apply: Tools > Update Python Environment (or aa-setup) on every
machine that uses these stores (an older aalibrary would not recognise the
new seal and would make those products again), and run it when no Prepare is
running. gcsfuse mounts may show the old objects for a minute or two after.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT_RE = re.compile(
    r"^(?P<store>.+?\.zarr)/(?P<rel>zarr\.json|\.zgroup|aa_seal/zarr\.json|"
    r"Provenance/zarr\.json|Sonar/zarr\.json)$"
)
TEXT_ATTRS = ("aa_provenance", "aa_write", "provenance")
# Object properties a rewrite carries over (custom metadata and content type
# are carried too). Zarr metadata objects written by the tools have none of
# them set; they are kept rather than reset to the bucket's defaults.
KEPT_PROPERTIES = (
    "cache_control",
    "content_disposition",
    "content_language",
    "custom_time",
    "storage_class",
    "kms_key_name",
)


class Changed(Exception):
    """An object is no longer the version that was read."""


class Objects:
    """Small objects read and written with generation preconditions: GCS
    through google-cloud-storage, or the stand-in bucket (AA_GCS_FAKE_ROOT)."""

    def __init__(self) -> None:
        from aalibrary.console._core import uris

        self._uris = uris
        self.fake = bool(os.getenv("AA_GCS_FAKE_ROOT"))
        self._client = None
        if not self.fake:
            from google.cloud import storage

            self._client = storage.Client(
                project=os.getenv("AALIBRARY_GCP_PROJECT_ID") or None
            )

    def list(self, bucket: str, prefix: str):
        return self._uris.backend().list(bucket, prefix)

    def get(self, bucket: str, key: str) -> dict | None:
        """{data, generation, metadata, content_type, properties, refuse}, or
        None if absent. refuse: why this object must not be rewritten."""
        if self.fake:
            info = self._uris.backend().stat(bucket, key)
            if info is None:
                return None
            path = Path(os.environ["AA_GCS_FAKE_ROOT"]) / bucket / key
            return {
                "data": path.read_bytes(),
                "generation": info.generation,
                "metadata": dict(info.metadata),
                "content_type": "application/json",
                "properties": {},
                "refuse": None,
            }
        blob = self._client.bucket(bucket).get_blob(key)
        if blob is None:
            return None
        refuse = None
        if blob.content_encoding:
            refuse = f"{key} is stored {blob.content_encoding}-encoded"
        elif blob.temporary_hold or blob.event_based_hold:
            refuse = f"{key} is under a hold"
        data = blob.download_as_bytes(if_generation_match=blob.generation)
        return {
            "data": data,
            "generation": str(blob.generation),
            "metadata": dict(blob.metadata or {}),
            "content_type": blob.content_type or "application/json",
            "properties": {
                name: getattr(blob, name, None)
                for name in KEPT_PROPERTIES
                if getattr(blob, name, None)
            },
            "refuse": refuse,
        }

    def put(self, bucket: str, key: str, data: bytes, current: dict) -> None:
        if self.fake:
            info = self._uris.backend().stat(bucket, key)
            if info is None or info.generation != current["generation"]:
                raise Changed(key)
            with tempfile.NamedTemporaryFile(delete=False) as handle:
                handle.write(data)
            try:
                self._uris.backend().upload(
                    Path(handle.name), bucket, key, current["metadata"]
                )
            finally:
                os.unlink(handle.name)
            return
        from google.api_core.exceptions import PreconditionFailed

        blob = self._client.bucket(bucket).blob(key)
        blob.metadata = current["metadata"] or None
        for name, value in current["properties"].items():
            setattr(blob, name, value)
        try:
            blob.upload_from_string(
                data,
                content_type=current["content_type"],
                if_generation_match=int(current["generation"]),
            )
        except PreconditionFailed as exc:
            raise Changed(key) from exc

    def delete(self, bucket: str, key: str, current: dict) -> None:
        if self.fake:
            info = self._uris.backend().stat(bucket, key)
            if info is None:
                return  # already gone
            if info.generation != current["generation"]:
                raise Changed(key)
            self._uris.backend().delete(bucket, key)
            return
        from google.api_core.exceptions import NotFound, PreconditionFailed

        try:
            self._client.bucket(bucket).blob(key).delete(
                if_generation_match=int(current["generation"])
            )
        except NotFound:
            return  # a retried delete whose first try went through
        except PreconditionFailed as exc:
            raise Changed(key) from exc


def find_stores(
    objects: Objects, bucket: str, prefix: str, only: str | None = None
) -> dict[str, set[str]]:
    """Every Zarr store below the prefix (or just ``only``): store key ->
    which of its metadata objects exist."""
    found: dict[str, set[str]] = {}
    for count, info in enumerate(objects.list(bucket, prefix), start=1):
        if count % 50_000 == 0:
            print(f"  listed {count:,} objects…", file=sys.stderr)
        match = ROOT_RE.match(info.key)
        if match and (only is None or match["store"] == only):
            found.setdefault(match["store"], set()).add(match["rel"])
    return {
        store: rels
        for store, rels in found.items()
        if "zarr.json" in rels or ".zgroup" in rels
    }


def _text(value) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True, ensure_ascii=False)


def _dump(doc: dict) -> bytes:
    return json.dumps(doc, indent=2).encode("utf-8")


def _not_its_own(
    objects: Objects, bucket: str, store: str, root: dict, attrs: dict, doc: dict
) -> str | None:
    """Why this store may not be the product its record describes; None if
    every check agrees it is."""
    from aalibrary.console._core import provenance, uris

    product = doc.get("product") or {}
    name = store.rsplit("/", 1)[-1]
    if product.get("name") != name:
        return f"its record names {product.get('name')!r}, not this store (a copy?)"
    side = objects.get(bucket, store + provenance.SIDECAR_SUFFIX)
    if side is None:
        return "no .aa.json record beside it"
    try:
        side_product = json.loads(side["data"]).get("product") or {}
    except ValueError:
        return "its .aa.json record doesn't parse"
    if (
        side_product.get("hash") != product.get("hash")
        or side_product.get("name") != name
    ):
        return "its .aa.json record names another product"
    stamped = root["metadata"].get(uris.META_HASH)
    if stamped and stamped != product.get("hash"):
        return "its root object's aa-product-hash names another product"
    marker = provenance.attr_json(attrs.get("aa_write"))
    if isinstance(marker, dict) and marker.get("complete") is not True:
        return "its write never finished (aa_write marker)"
    return None


def plan(objects: Objects, bucket: str, store: str, rels: set[str]) -> dict:
    """What re-sealing this store would write, or why it is left alone."""
    import zarr
    from aalibrary.console._core import provenance

    uri = f"gs://{bucket}/{store}"
    out: dict = {"uri": uri, "writes": [], "delete": None, "structured": []}
    if "zarr.json" not in rels:
        return dict(out, skip="a Zarr v2 store (the tools never sealed those this way)")
    echodata = "Provenance/zarr.json" in rels and "Sonar/zarr.json" in rels
    out["kind"] = "EchoData" if echodata else "other"
    root = objects.get(bucket, f"{store}/zarr.json")
    if root is None:
        return dict(out, skip="its root metadata is gone")
    root_doc = json.loads(root["data"])
    attrs = root_doc.get("attributes") or {}
    listing = (root_doc.get("consolidated_metadata") or {}).get("metadata")
    old_seal = "aa_seal/zarr.json" in rels
    structured = [k for k in TEXT_ATTRS if isinstance(attrs.get(k), (dict, list))]
    if provenance.ATTR not in attrs:
        return dict(out, skip="no aa record (not made by the console tools)")
    prov = objects.get(bucket, f"{store}/Provenance/zarr.json") if echodata else None
    new_style = (
        echodata
        and prov is not None
        and provenance.SEAL_ECHODATA_ATTR
        in (json.loads(prov["data"]).get("attributes") or {})
    )
    seal_obj = objects.get(bucket, f"{store}/aa_seal/zarr.json") if old_seal else None
    seal_doc = json.loads(seal_obj["data"]) if seal_obj else None
    has_shape = bool(
        seal_doc and (seal_doc.get("attributes") or {}).get(provenance.SEAL_SHAPE_ATTR)
    )
    if not structured and (
        (echodata and new_style and not old_seal) or (not echodata and has_shape)
    ):
        return dict(out, skip="already up to date", current=True)
    if not isinstance(listing, dict):
        return dict(out, skip="no consolidated listing of itself")
    for obj in (root, prov, seal_obj):
        if obj is not None and obj.get("refuse"):
            return dict(out, skip=obj["refuse"])

    doc, status = provenance.inspect_store(uri)
    if status != "embedded":
        return dict(out, skip=f"its record is not its own ({status})")
    why = _not_its_own(objects, bucket, store, root, attrs, doc)
    if why:
        return dict(out, skip=why)
    listed = {
        k: tuple(v.get("shape") or ())
        for k, v in listing.items()
        if isinstance(v, dict)
        and v.get("node_type") == "array"
        and k.split("/", 1)[0] != provenance.SEAL_GROUP
    }
    group = zarr.open_group(uri, mode="r", use_consolidated=False)
    walked = provenance.group_shapes(group)
    if listed != walked:
        return dict(out, skip="its listing of itself differs from its arrays")
    seal = {
        provenance.SEAL_ATTR: doc["product"]["hash"],
        provenance.SEAL_SHAPE_ATTR: provenance.shape_print(walked),
    }
    out["hash"] = doc["product"]["hash"]

    # 1. the new seal (the store stays its own: the old seal is still there)
    if echodata:
        prov_doc = json.loads(prov["data"])
        prov_doc.setdefault("attributes", {})[provenance.SEAL_ECHODATA_ATTR] = _text(
            seal
        )
        out["writes"].append(("Provenance/zarr.json", _dump(prov_doc), prov))
        if isinstance(listing.get("Provenance"), dict):
            listing["Provenance"].setdefault("attributes", {})[
                provenance.SEAL_ECHODATA_ATTR
            ] = _text(seal)
        for key in [k for k in listing if k.split("/", 1)[0] == provenance.SEAL_GROUP]:
            del listing[key]
    elif seal_doc is not None:
        seal_doc.setdefault("attributes", {}).update(seal)
        out["writes"].append(("aa_seal/zarr.json", _dump(seal_doc), seal_obj))
        if isinstance(listing.get(provenance.SEAL_GROUP), dict):
            listing[provenance.SEAL_GROUP].setdefault("attributes", {}).update(seal)
    # 2. the root: records as text, its listing following the seal
    for key in structured:
        attrs[key] = _text(attrs[key])
    out["writes"].append(("zarr.json", _dump(root_doc), root))
    # 3. the old seal group of an EchoData
    if echodata and seal_obj is not None:
        out["delete"] = ("aa_seal/zarr.json", seal_obj)
    out["structured"] = structured
    return out


def _forget_listings() -> None:
    """gcsfs keeps what it listed (object sizes included) for the life of the
    process; the objects just rewritten must be read as they are now."""
    try:
        import gcsfs
    except ImportError:
        return
    gcsfs.GCSFileSystem.clear_instance_cache()


def apply(objects: Objects, bucket: str, store: str, step: dict) -> str | None:
    """Write the plan; None if done and verified, else what went wrong."""
    import zarr
    from aalibrary.console._core import provenance

    try:
        for rel, data, current in step["writes"]:
            objects.put(bucket, f"{store}/{rel}", data, current)
        if step["delete"]:
            rel, current = step["delete"]
            objects.delete(bucket, f"{store}/{rel}", current)
    except Changed as exc:
        return (
            f"{exc} changed while this ran (or a retried write had already gone "
            "through); the store is left as it now is: run this again"
        )
    except Exception as exc:  # noqa: BLE001 - one store's error never stops the rest
        return (
            f"{type(exc).__name__}: {exc}. The store is still its own product; "
            "run this again to finish it"
        )
    _forget_listings()
    doc, status = provenance.inspect_store(step["uri"])
    if status != "embedded" or doc["product"]["hash"] != step["hash"]:
        return f"after the rewrite its record reads as {status}"
    if step["kind"] == "EchoData" and provenance.SEAL_GROUP in zarr.open_group(
        step["uri"], mode="r"
    ):
        return "its listing still shows aa_seal"
    return None


def _describe(step: dict) -> str:
    what = (
        "seal moved into Provenance, aa_seal removed"
        if step["kind"] == "EchoData"
        else "seal gains its shape"
    )
    if step["structured"]:
        what += "; " + ", ".join(step["structured"]) + " as text"
    return f"{step['kind']}: {what}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Bring Zarr stores made before catch-up 16 up to date, in place "
        "(metadata only). Without --apply it only lists what it would do.",
        epilog="See the top of this file for what changes, and the checks.",
    )
    parser.add_argument(
        "prefix", help="gs://BUCKET/derived_products/YOU/ (or any folder, or one store)"
    )
    parser.add_argument("--apply", action="store_true", help="make the changes")
    args = parser.parse_args(argv)
    try:
        from aalibrary.console._core import provenance, uris
    except ImportError:
        print(
            "aalibrary is not installed in this Python: "
            "run it with ~/venv313/bin/python",
            file=sys.stderr,
        )
        return 2
    if not hasattr(provenance, "store_is_own"):
        print(
            "This aalibrary predates catch-up 16: Tools > Update Python Environment "
            "(or aa-setup) first.",
            file=sys.stderr,
        )
        return 2
    if not uris.is_gcs(args.prefix):
        print(f"not a gs:// prefix: {args.prefix}", file=sys.stderr)
        return 2
    import warnings

    warnings.simplefilter("ignore")
    bucket, prefix = uris.parse_gcs(args.prefix)
    prefix = prefix.rstrip("/")
    only = prefix if prefix.endswith(".zarr") else None
    listing = f"{prefix}/" if prefix else ""
    objects = Objects()
    print(f"Listing gs://{bucket}/{listing} …", file=sys.stderr)
    stores = find_stores(objects, bucket, listing, only)
    counts = {"to do": 0, "done": 0, "current": 0}
    left: list[tuple[str, str]] = []
    failed: list[tuple[str, str]] = []
    print(f"{len(stores)} store(s) found; one at a time:")
    for index, store in enumerate(sorted(stores), start=1):
        try:
            step = plan(objects, bucket, store, stores[store])
        except Exception as exc:  # noqa: BLE001 - one unreadable store never stops the rest
            step = {
                "uri": f"gs://{bucket}/{store}",
                "skip": f"could not be read ({exc})",
            }
        if step.get("current"):
            counts["current"] += 1
        elif step.get("skip"):
            left.append((step["uri"], step["skip"]))
            print(f"  left   {step['uri']}: {step['skip']}")
        elif not args.apply:
            counts["to do"] += 1
            print(f"  would  {step['uri']} ({_describe(step)})")
        else:
            counts["to do"] += 1
            problem = apply(objects, bucket, store, step)
            if problem:
                failed.append((step["uri"], problem))
                print(f"  FAILED {step['uri']}: {problem}")
            else:
                counts["done"] += 1
                print(f"  done   {step['uri']} ({_describe(step)})")
        if index % 50 == 0:
            _forget_listings()  # keeps gcsfs's listing cache small
    print(
        f"{len(stores)} store(s): {counts['to do']} to bring up to date, "
        f"{counts['current']} already up to date, {len(left)} left alone."
    )
    if not args.apply:
        if counts["to do"]:
            print("Nothing changed. Add --apply to make these changes.")
        return 0
    print(f"{counts['done']} brought up to date, {len(failed)} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
