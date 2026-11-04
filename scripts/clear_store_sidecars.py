"""Delete the .aa.json files older tools left beside Zarr stores.

    ~/venv313/bin/python clear_store_sidecars.py gs://BUCKET/derived_products/YOU/
        looks and changes nothing;
    ~/venv313/bin/python clear_store_sidecars.py gs://BUCKET/derived_products/YOU/ --apply
        deletes them.

A Zarr store keeps its record (where it came from, every step, its product
hash) in its own root metadata. Until catch-up 19 the console tools also wrote
a copy beside it, `X.zarr.aa.json`. Nothing needs that copy now: the tools and
the Workbench read the record from the store. The copy can mislead, though.
When a store is replaced, the old copy beside it describes the store that was
there before, and a listing of `X.zarr` without a trailing slash picks it up
along with the store.

A copy is deleted only when the store has a record of its own that the
current tools accept, so the copy isn't the only record. Of those, the copy is
"the same" when it names the same product as the store, and "stale" when it
describes another one. Copies are left where they are when:
  - the store has no record of its own, or one the tools don't accept as its
    own (a copy of another product, say);
  - the store still needs reseal_stores.py, which uses the copy beside the
    store to check that the store is genuine. Run that first, then this.
  - the copy has no store beside it (e.g. the store itself was deleted).
Each copy is deleted only if it is still the version that was read. Stores are
done one at a time; one that fails is reported and the rest carry on.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

SIDECAR = ".aa.json"


def _reseal_module():
    path = Path(__file__).with_name("reseal_stores.py")
    spec = importlib.util.spec_from_file_location("reseal_stores", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def find(objects, bucket: str, prefix: str, only: str | None = None):
    """(sidecars beside stores, sidecars with no store): store key -> sidecar key."""
    sidecars: dict[str, str] = {}
    roots: set[str] = set()
    for count, info in enumerate(objects.list(bucket, prefix), start=1):
        if count % 50_000 == 0:
            print(f"  listed {count:,} objects…", file=sys.stderr)
        key = info.key
        if key.endswith(".zarr" + SIDECAR):
            store = key[: -len(SIDECAR)]
            if only is None or store == only:
                sidecars[store] = key
        elif key.endswith((".zarr/zarr.json", ".zarr/.zgroup")):
            roots.add(key.rsplit("/", 1)[0])
    beside = {store: side for store, side in sidecars.items() if store in roots}
    alone = {store: side for store, side in sidecars.items() if store not in roots}
    return beside, alone


def plan(objects, reseal, bucket: str, store: str, side_key: str) -> dict:
    """What to do with one sidecar: {"uri", "side", and "delete" (why) or "keep" (why)}."""
    from aalibrary.console._core import provenance

    uri = f"gs://{bucket}/{store}"
    step = {"uri": uri, "side": f"gs://{bucket}/{side_key}"}
    side = objects.get(bucket, side_key)
    if side is None:
        return dict(step, keep="already gone")
    step["object"] = side
    rels = {
        rel
        for rel in (
            "zarr.json",
            ".zgroup",
            "aa_seal/zarr.json",
            "Provenance/zarr.json",
            "Sonar/zarr.json",
        )
        if objects.get(bucket, f"{store}/{rel}") is not None
    }
    resealing = reseal.plan(objects, bucket, store, rels)
    if not resealing.get("current") and not resealing.get("skip"):
        return dict(
            step,
            keep="the store still needs reseal_stores.py, which checks it against this copy",
        )
    doc, status = provenance.inspect_store(uri)
    if doc is None or status != "embedded":
        return dict(step, keep=f"the store has no record of its own ({status})")
    try:
        copy = json.loads(side["data"])
    except ValueError:
        copy = {}
    own = (doc.get("product") or {}).get("hash")
    theirs = ((copy or {}).get("product") or {}).get("hash")
    return dict(step, delete="the same record" if own == theirs else "stale")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Delete the .aa.json files beside Zarr stores (each store holds its "
        "own record). Without --apply it only lists what it would do.",
        epilog="See the top of this file for which ones are deleted.",
    )
    parser.add_argument(
        "prefix", help="gs://BUCKET/derived_products/YOU/ (or any folder, or one store)"
    )
    parser.add_argument("--apply", action="store_true", help="delete them")
    args = parser.parse_args(argv)
    try:
        from aalibrary.console._core import uris
    except ImportError:
        print(
            "aalibrary is not installed in this Python: run it with ~/venv313/bin/python",
            file=sys.stderr,
        )
        return 2
    if not hasattr(uris, "drop_store_sidecar"):
        print(
            "This aalibrary predates catch-up 19 (it would write these files again): "
            "Tools > Update Python Environment (or aa-setup) first.",
            file=sys.stderr,
        )
        return 2
    if not uris.is_gcs(args.prefix):
        print(f"not a gs:// prefix: {args.prefix}", file=sys.stderr)
        return 2
    import warnings

    warnings.simplefilter("ignore")
    reseal = _reseal_module()
    bucket, prefix = uris.parse_gcs(args.prefix)
    prefix = prefix.rstrip("/")
    only = prefix if prefix.endswith(".zarr") else None
    if only:  # one store: its folder holds both the store and the copy beside it
        listing = prefix.rsplit("/", 1)[0] + "/" if "/" in prefix else ""
    else:
        listing = f"{prefix}/" if prefix else ""
    objects = reseal.Objects()
    print(f"Listing gs://{bucket}/{listing} …", file=sys.stderr)
    beside, alone = find(objects, bucket, listing, only)
    deleted = to_delete = 0
    kept: list[tuple[str, str]] = []
    failed: list[tuple[str, str]] = []
    print(f"{len(beside)} .aa.json beside a store; one at a time:")
    for index, store in enumerate(sorted(beside), start=1):
        try:
            step = plan(objects, reseal, bucket, store, beside[store])
        except Exception as exc:  # noqa: BLE001 - one unreadable store never stops the rest
            step = {
                "side": f"gs://{bucket}/{beside[store]}",
                "keep": f"could not be read ({exc})",
            }
        if "keep" in step:
            kept.append((step["side"], step["keep"]))
            print(f"  left    {step['side']}: {step['keep']}")
        elif not args.apply:
            to_delete += 1
            print(f"  would   delete {step['side']} ({step['delete']})")
        else:
            to_delete += 1
            try:
                objects.delete(bucket, beside[store], step["object"])
            except reseal.Changed:
                failed.append(
                    (step["side"], "it changed while this ran; run this again")
                )
                print(f"  FAILED  {step['side']}: it changed while this ran")
                continue
            except Exception as exc:  # noqa: BLE001 - report it, carry on
                failed.append((step["side"], str(exc)))
                print(f"  FAILED  {step['side']}: {exc}")
                continue
            deleted += 1
            print(f"  deleted {step['side']} ({step['delete']})")
        if index % 50 == 0:
            reseal._forget_listings()
    for store, side in sorted(alone.items()):
        print(f"  left    gs://{bucket}/{side}: no store beside it")
    print(
        f"{len(beside)} beside a store: {to_delete} to delete, {len(kept)} left; "
        f"{len(alone)} with no store, left."
    )
    if not args.apply:
        if to_delete:
            print("Nothing changed. Add --apply to delete them.")
        return 0
    print(f"{deleted} deleted.")
    if failed:
        print(f"{len(failed)} could not be deleted:")
        for side, why in failed:
            print(f"  {side}: {why}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
