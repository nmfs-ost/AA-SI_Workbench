"""Check a finished Prepare EchoData run, file by file with Sv, from the bucket.

    ~/venv313/bin/python check_prepare_run.py gs://BUCKET/derived_products/YOU/VESSEL/SURVEY/BASE/
    ~/venv313/bin/python check_prepare_run.py gs://…/BASE/ --no-sample     # metadata only

Read-only: it lists objects, reads records and metadata (kilobytes each) and,
unless --no-sample, a few pings of Sv. It never writes anything, anywhere.

It answers what the run's card can't, from what is in the bucket:
  - EK80 modes: each file's beam groups (complex CW/FM or power), and which
    one Sv was calibrated from; channels or pings left out of the Sv;
  - sizes: each file's raw, EchoData and Sv, against the Workbench's estimates;
  - the join: pings, order, gaps, depth padding, and environment that differs
    between files; a few pings of the joined Sv against each file's own;
  - when each file was converted and calibrated (from the records);
  - what else is in the folders: stores no product here uses, an old
    per_file/ folder, stores still sealed the old way;
  - this machine: memory, free space, run folders and the download cache.
Paste its output back, with the notes from the run's card (they hold the
peak working space; peak memory isn't recorded anywhere).
"""

from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import os
import shutil
import statistics
import sys
import warnings
from pathlib import Path

# The Workbench's estimate factors (backend/src/aa_si_workbench/api/workspace.py).
ECHODATA_PER_RAW = 2.2
SV_PER_RAW = 4.5
CONVERT_MEMORY_PER_RAW = 3.0

findings: list[str] = []


def flag(text: str) -> None:
    findings.append(text)
    print(f"  ! {text}")


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1000 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1000
    return f"{n:.1f} TB"


def when(text: str | None) -> dt.datetime | None:
    try:
        return dt.datetime.strptime(str(text), "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=dt.UTC
        )
    except (TypeError, ValueError):
        return None


def section(title: str) -> None:
    print(f"\n== {title}")


class Bucket:
    """Listing and records, read-only, through aalibrary (GCS, or the
    stand-in bucket when AA_GCS_FAKE_ROOT is set)."""

    def __init__(self) -> None:
        from aalibrary.console._core import provenance, uris

        self.uris, self.prov = uris, provenance
        self._sizes: dict[str, dict[str, int]] = {}
        self.objects_seen: dict[str, list] = {}

    def listing(self, prefix_uri: str) -> list:
        bucket, key = self.uris.parse_gcs(prefix_uri)
        key = key.rstrip("/") + "/"
        if prefix_uri not in self.objects_seen:
            self.objects_seen[prefix_uri] = list(self.uris.backend().list(bucket, key))
        return self.objects_seen[prefix_uri]

    def top_level(self, prefix_uri: str) -> dict[str, dict]:
        """Name -> {bytes, objects, meta (root object's aa- metadata)} for
        everything directly in a folder (a store counts as one item)."""
        _bucket, key = self.uris.parse_gcs(prefix_uri)
        key = key.rstrip("/") + "/"
        out: dict[str, dict] = {}
        for info in self.listing(prefix_uri):
            rest = info.key[len(key) :]
            name = rest.split("/", 1)[0]
            item = out.setdefault(name, {"bytes": 0, "objects": 0, "meta": {}})
            item["bytes"] += info.size
            item["objects"] += 1
            if rest in (name, f"{name}/zarr.json", f"{name}/.zattrs"):
                item["meta"] = info.metadata
        return out

    def record(self, uri: str) -> tuple[dict | None, str]:
        try:
            return self.prov.inspect_store(self.uris.in_place(uri))
        except Exception as exc:  # noqa: BLE001 - reported, never fatal
            return None, f"unreadable ({exc})"

    def old_seal(self, uri: str) -> bool:
        """Sealed before catch-up 16 (an aa_seal group with no shape)."""
        try:
            import zarr

            group = zarr.open_group(self.uris.in_place(uri), mode="r")
            if "Sonar" in group and "Provenance" in group:
                return "aa_seal" not in group["Provenance"].attrs
            return "aa_seal" in group and "shape" not in group["aa_seal"].attrs
        except Exception:  # noqa: BLE001
            return False


def raw_size(doc: dict | None) -> int | None:
    for src in (doc or {}).get("sources") or []:
        tail = str(src.get("id", "")).rsplit(":", 1)[-1]
        if tail.isdigit():
            return int(tail)
    return None


def step_params(doc: dict | None, tool: str) -> dict:
    for step in reversed((doc or {}).get("pipeline") or []):
        if step.get("tool") == tool:
            return step.get("params") or {}
    return {}


def beam_groups(bucket: Bucket, uri: str) -> list[dict]:
    """[{name, mode, channels, pings}] for an EchoData store, from metadata."""
    import zarr

    group = zarr.open_group(bucket.uris.in_place(uri), mode="r")
    sonar = group["Sonar"]
    names = [str(n) for n in sonar["beam_group"][:]] if "beam_group" in sonar else []
    if "waveform_encode_descr" in sonar:
        modes = [str(m) for m in sonar["waveform_encode_descr"][:]]
    else:
        modes = ["power"] * len(names)  # EK60: power and angle only
    out = []
    for name, mode in zip(names, modes):
        beam = sonar[name]
        out.append(
            {
                "name": name,
                "mode": mode,
                "channels": [str(c) for c in beam["channel"][:]],
                "pings": int(beam["ping_time"].shape[0]),
            }
        )
    return out


def _ratio(size: int | None, raw: int) -> str:
    return f"{size / raw:5.2f}" if raw and size else "    -"


def _short(channel: str) -> str:
    """'WBT 545612-15 ES38-7_ES' -> the part that names the frequency, roughly."""
    words = str(channel).split()
    for i, word in enumerate(words):
        if word.lower().startswith("khz") and i:
            return f"{words[i - 1]} kHz"
        if word.lower().endswith("khz"):
            return word
    return " ".join(words[-1:]) or str(channel)


def calibrated_mode(params: dict, sonar_model: str) -> str:
    if sonar_model not in ("EK80", "ES80", "EA640"):
        return "power"
    if (params.get("encode_mode") or "").lower() == "power":
        return "power"
    waveform = (params.get("waveform_mode") or "").upper()
    return "complex_CW" if waveform == "CW" else "complex_FM"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("asset", help="the run's asset folder, gs://…/SURVEY/BASE/")
    parser.add_argument(
        "--no-sample", action="store_true", help="metadata only: read no Sv values"
    )
    args = parser.parse_args(argv)
    warnings.simplefilter("ignore")
    try:
        import numpy as np
        import xarray as xr
    except ImportError:
        print(
            "Run it with ~/venv313/bin/python (xarray and aalibrary are there).",
            file=sys.stderr,
        )
        return 2
    bucket = Bucket()
    asset = args.asset.rstrip("/") + "/"
    base = asset.rstrip("/").rsplit("/", 1)[-1]
    survey = asset.rstrip("/").rsplit("/", 1)[0] + "/"
    print(f"Prepare run {base}\n  {asset}")

    # ---------------------------------------------------------------- asset
    section("Products in the asset folder")
    items = bucket.top_level(asset)
    if not items:
        print("  nothing there")
        return 1
    joined = combined = None
    for name, item in sorted(items.items()):
        kind = item["meta"].get("aa-kind", "")
        uri = asset + name
        doc, status = bucket.record(uri) if name.endswith(".zarr") else (None, "")
        kind = kind or ((doc or {}).get("product") or {}).get("kind", "")
        made = ((doc or {}).get("created") or {}).get("at", "")
        print(
            f"  {name:70s} {human(item['bytes']):>10s} {item['objects']:>7,} objects"
            f"  {kind or '-':9s} {status:9s} {made}"
        )
        if name.endswith(".zarr") and doc:
            if doc["product"]["kind"] == "sv":
                joined = (
                    (uri, doc)
                    if joined is None or made > joined[1]["created"]["at"]
                    else joined
                )
            elif doc["product"]["kind"] == "echodata":
                combined = (uri, doc)
        elif name.endswith(".zarr") and status != "embedded":
            flag(f"{name}: its record reads as {status}")
    if joined is None:
        flag("no Sv in the asset folder: nothing to check the join against")
        return 1
    joined_uri, joined_doc = joined
    tools = [(s.get("tool"), s.get("count")) for s in joined_doc.get("pipeline") or []]
    print(f"  Sv pipeline: {' → '.join(f'{t}×{c}' if c else t for t, c in tools)}")
    software = joined_doc.get("software") or {}
    print(
        f"  made with aalibrary {software.get('aalibrary')}, echopype "
        f"{software.get('echopype')}, xarray {software.get('xarray')}, zarr "
        f"{software.get('zarr')}"
    )
    params = step_params(joined_doc, "aa-sv")
    sonar_model = next(
        (
            s.get("params", {}).get("sonar_model")
            for s in joined_doc.get("pipeline") or []
            if s.get("tool") == "aa-ed"
        ),
        "",
    )
    print(
        f"  echosounder {sonar_model}; aa-sv options {json.dumps(params, sort_keys=True)}"
    )

    # ------------------------------------------------------------ per file
    section("Each file: raw, EchoData and Sv")
    per_sv = [i["uri"] for i in joined_doc.get("inputs") or [] if i.get("uri")]
    if not per_sv:
        flag("the joined Sv's record lists no inputs (one file, or a whole-range Sv)")
    files_folder = per_sv[0].rsplit("/", 1)[0] + "/" if per_sv else None
    folder = bucket.top_level(files_folder) if files_folder else {}
    rows = []
    for sv_uri in per_sv:
        sv_name = sv_uri.rsplit("/", 1)[1]
        sv_doc, sv_status = bucket.record(sv_uri)
        ed_uri = next(
            (i["uri"] for i in (sv_doc or {}).get("inputs") or [] if i.get("uri")), None
        )
        ed_name = ed_uri.rsplit("/", 1)[1] if ed_uri else None
        ed_doc, ed_status = bucket.record(ed_uri) if ed_uri else (None, "missing")
        row = {
            "sv_uri": sv_uri,
            "sv": sv_name,
            "sv_doc": sv_doc,
            "sv_status": sv_status,
            "ed_uri": ed_uri,
            "ed": ed_name,
            "ed_doc": ed_doc,
            "ed_status": ed_status,
            "raw": raw_size(ed_doc) or raw_size(sv_doc),
            "ed_bytes": folder.get(ed_name, {}).get("bytes") if ed_name else None,
            "sv_bytes": folder.get(sv_name, {}).get("bytes"),
            "first": None,
        }
        try:
            row["part"] = xr.open_zarr(bucket.uris.in_place(sv_uri), chunks={})
            row["first"] = row["part"]["ping_time"].values[0]
        except Exception as exc:  # noqa: BLE001
            flag(f"{sv_name}: could not be opened ({exc})")
        rows.append(row)
    # In time order, as they were joined (the record lists them in any order).
    rows.sort(
        key=lambda r: (
            r["first"] is None,
            r["first"] if r["first"] is not None else 0,
            r["sv"],
        )
    )
    print(f"  {len(rows)} files in {files_folder}")
    print(
        f"  {'file':42s} {'raw':>9s} {'EchoData':>9s} {'×raw':>5s} {'Sv':>9s} {'×raw':>5s}"
    )
    for row in rows:
        raw = row["raw"] or 0
        print(
            f"  {row['ed'] or row['sv']:42s} {human(raw):>9s} "
            f"{human(row['ed_bytes'] or 0):>9s} {_ratio(row['ed_bytes'], raw)} "
            f"{human(row['sv_bytes'] or 0):>9s} {_ratio(row['sv_bytes'], raw)}"
        )
        for key in ("ed_status", "sv_status"):
            if row[key] != "embedded":
                flag(f"{row['ed'] or row['sv']}: {key[:2]} record reads as {row[key]}")
    raws = [r["raw"] for r in rows if r["raw"]]
    if raws:
        total_raw = sum(raws)
        total_ed = sum(r["ed_bytes"] or 0 for r in rows)
        total_sv = sum(r["sv_bytes"] or 0 for r in rows)
        print(
            f"  total: raw {human(total_raw)}, EchoData {human(total_ed)} "
            f"({total_ed / total_raw:.2f}× raw; Workbench estimate {ECHODATA_PER_RAW}×), "
            f"Sv {human(total_sv)} ({total_sv / total_raw:.2f}× raw; estimate {SV_PER_RAW}×)"
        )
        print(
            f"  largest raw {human(max(raws))}: the Workbench counted "
            f"{human(CONVERT_MEMORY_PER_RAW * max(raws))} of memory for its conversion"
        )

    # ------------------------------------------------------------ EK80 modes
    section("Beam groups and what the Sv was calibrated from")
    wanted = calibrated_mode(params, sonar_model)
    print(f"  Sv calibrated from: {wanted}")
    layouts: dict[str, list[str]] = {}
    pings_by_mode: dict[str, int] = {}
    left_out_pings = 0
    all_channels: set[str] = set()
    for row in rows:
        if not row["ed_uri"]:
            continue
        try:
            groups = beam_groups(bucket, row["ed_uri"])
        except Exception as exc:  # noqa: BLE001
            flag(f"{row['ed']}: beam groups unreadable ({exc})")
            continue
        text = "; ".join(
            f"{g['name']} {g['mode']} ({len(g['channels'])} channel"
            f"{'s' if len(g['channels']) != 1 else ''}: "
            f"{', '.join(_short(c) for c in g['channels'])})"
            for g in groups
        )
        layouts.setdefault(text, []).append(row["ed"])
        for g in groups:
            all_channels.update(g["channels"])
            pings_by_mode[g["mode"]] = pings_by_mode.get(g["mode"], 0) + g["pings"]
            if g["mode"] != wanted:
                left_out_pings += g["pings"] * len(g["channels"])
        row["groups"] = groups
    for text, names in layouts.items():
        print(f"  {len(names):3d} file(s): {text}")
        if len(layouts) > 1:
            print(f"       e.g. {', '.join(names[:3])}")
    if pings_by_mode:
        print(
            "  pings per beam group, all files: "
            + ", ".join(f"{mode} {n:,}" for mode, n in pings_by_mode.items())
        )
    if left_out_pings:
        flag(
            f"beam groups other than {wanted} hold {left_out_pings:,} channel-pings that "
            "are in no Sv (another --encode_mode/--waveform_mode would calibrate them)"
        )

    # ------------------------------------------------------------ the join
    section("The joined Sv")
    try:
        sv = xr.open_zarr(bucket.uris.in_place(joined_uri), chunks={})
    except Exception as exc:  # noqa: BLE001
        flag(f"the joined Sv could not be opened: {exc}")
        return report()
    sizes = dict(sv.sizes)
    print(
        f"  {joined_uri.rsplit('/', 1)[1]}: "
        + ", ".join(f"{k} {v:,}" for k, v in sizes.items())
    )
    channels = [str(c) for c in sv["channel"].values]
    print(f"  channels: {', '.join(channels)}")
    missing = sorted(all_channels - set(channels))
    if missing:
        flag(f"channels in the EchoData but not in the Sv: {', '.join(missing)}")
    times = sv["ping_time"].values
    steps = np.diff(times).astype("timedelta64[ms]").astype(float) / 1000
    parts = [r["part"] for r in rows if "part" in r]
    per_file_pings = [int(p.sizes["ping_time"]) for p in parts]
    per_file_samples = [int(p.sizes.get("range_sample", 0)) for p in parts]
    print(
        f"  pings: {len(times):,} joined, {sum(per_file_pings):,} in the files' own Sv"
    )
    if per_file_pings and len(times) != sum(per_file_pings):
        flag("the joined Sv's pings differ from the sum of the files' own")
    if len(steps) and not (steps > 0).all():
        flag(
            f"ping times are not increasing at {int((steps <= 0).sum())} place(s) "
            "(files that overlap; aa-graph refuses these)"
        )
    if len(steps):
        median = float(np.median(steps))
        print(
            f"  ping interval: median {median:.2f} s; first ping "
            f"{str(times[0])[:19]}, last {str(times[-1])[:19]}"
        )
        big = np.argsort(steps)[::-1][:3]
        gaps = [
            f"{steps[i]:.0f} s after {str(times[i])[:19]}"
            for i in big
            if steps[i] > 10 * max(median, 0.001)
        ]
        if gaps:
            print(f"  longest gaps: {'; '.join(gaps)}")
    if per_file_samples:
        print(
            f"  depth samples: joined {sizes.get('range_sample', 0):,}; files "
            f"{min(per_file_samples):,} to {max(per_file_samples):,}"
            + (
                " (padded where shorter)"
                if min(per_file_samples) != max(per_file_samples)
                else ""
            )
        )
    for name in ("sound_speed", "sound_absorption"):
        if name in sv and "ping_time" in sv[name].dims:
            values = sv[name].values
            spread = np.nanmax(values, axis=-1) - np.nanmin(values, axis=-1)
            print(
                f"  {name}: varies by up to {np.nanmax(spread):.4g} across pings "
                "(EK80: each file is calibrated with its own; a whole-range combine "
                "would interpolate between files)"
                if np.nanmax(spread) > 0
                else f"  {name}: the same for every ping"
            )

    # ------------------------------------------------------------ timeline
    section("When each file was done (from the records)")
    for label, key in (("EchoData", "ed_doc"), ("Sv", "sv_doc")):
        stamps = sorted(
            t
            for t in (
                when(((r[key] or {}).get("created") or {}).get("at")) for r in rows
            )
            if t
        )
        if not stamps:
            continue
        runs, current = [], [stamps[0]]
        for prev, nxt in itertools.pairwise(stamps):
            if (nxt - prev).total_seconds() > 6 * 3600:
                runs.append(current)
                current = []
            current.append(nxt)
        runs.append(current)
        for run in runs:
            gaps = [(b - a).total_seconds() for a, b in itertools.pairwise(run)]
            pace = (
                f"; about {statistics.median(gaps) / 60:.1f} min per file (median), "
                f"longest {max(gaps) / 60:.1f} min"
                if gaps
                else ""
            )
            print(
                f"  {label}: {len(run)} file(s) {run[0]:%Y-%m-%d %H:%M} to "
                f"{run[-1]:%H:%M} UTC{pace}"
            )
    made = when((joined_doc.get("created") or {}).get("at"))
    if made:
        print(f"  joined Sv: {made:%Y-%m-%d %H:%M} UTC")

    # ------------------------------------------------------------ samples
    if not args.no_sample and rows and all("part" in r for r in rows):
        section("A few pings: the joined Sv against each file's own")
        offset = 0
        for index, row in enumerate(rows):
            part = row["part"]
            count = int(part.sizes["ping_time"])
            if index in (0, len(rows) - 1):
                take = min(5, count)
                for where in (0, count - take):
                    own = part["Sv"].isel(ping_time=slice(where, where + take)).values
                    depth = own.shape[-1]
                    got = (
                        sv["Sv"]
                        .isel(ping_time=slice(offset + where, offset + where + take))
                        .transpose(*part["Sv"].dims)
                        .values
                    )
                    same = np.array_equal(own, got[..., :depth], equal_nan=True)
                    padded = got.shape[-1] == depth or bool(
                        np.isnan(got[..., depth:]).all()
                    )
                    finite = own[np.isfinite(own)]
                    spread = (
                        f"Sv {np.percentile(finite, 5):.1f} to "
                        f"{np.percentile(finite, 95):.1f} dB (5–95%)"
                        if finite.size
                        else "no finite values"
                    )
                    print(
                        f"  {row['sv'][:40]:40s} pings {where}–{where + take - 1}: "
                        f"{'identical' if same and padded else 'DIFFERENT'}; {spread}"
                    )
                    if not (same and padded):
                        flag(f"{row['sv']}: the joined Sv differs from the file's own")
            offset += count

    # ------------------------------------------------------------ elsewhere
    section("Elsewhere in the bucket")
    used = {r["ed"] for r in rows} | {r["sv"] for r in rows}
    others = [n for n in folder if n.endswith(".zarr") and n not in used]
    if others:
        print(
            f"  {len(others)} other store(s) in {files_folder}, "
            f"{human(sum(folder[n]['bytes'] for n in others))} (other ranges, "
            "or other settings): "
            + ", ".join(sorted(others)[:4])
            + (" …" if len(others) > 4 else "")
        )
    old = bucket.top_level(survey + "per_file/")
    if old:
        flag(
            f"{survey}per_file/ still holds {sum(i['objects'] for i in old.values()):,} "
            f"objects, {human(sum(i['bytes'] for i in old.values()))} (catch-up 15's "
            "move_per_file_stores.sh moves them)"
        )
    else:
        print(f"  no old per_file/ folder in {survey}")
    sealed_old = [
        u
        for u in [
            *(r["ed_uri"] for r in rows if r["ed_uri"]),
            *(r["sv_uri"] for r in rows),
            joined_uri,
            *([combined[0]] if combined else []),
        ]
        if bucket.old_seal(u)
    ]
    if sealed_old:
        print(
            f"  {len(sealed_old)} of these stores are sealed the old way; "
            "reseal_stores.py brings them up to date (echopype can then display "
            "their EchoData)"
        )

    # ------------------------------------------------------------ machine
    section("This machine")
    try:
        with open("/proc/meminfo") as handle:
            mem = {
                k: int(v.split()[0]) * 1024
                for k, v in (line.split(":", 1) for line in handle)
            }
        print(
            f"  memory {human(mem['MemTotal'])}, available now "
            f"{human(mem.get('MemAvailable', 0))}"
        )
        if raws and mem["MemTotal"] < CONVERT_MEMORY_PER_RAW * max(raws):
            flag(
                "this machine has less memory than the Workbench counts for the largest "
                "file"
            )
    except OSError:
        pass
    home = Path.home()
    usage = shutil.disk_usage(home)
    print(f"  home folder: {human(usage.free)} free of {human(usage.total)}")
    for label, path in (
        ("run folders", Path(os.getenv("AASI_RUN_ROOT", home / "aa-workbench-runs"))),
        (
            "download cache",
            Path(os.getenv("AA_CACHE_DIR", home / ".cache" / "aalibrary")),
        ),
    ):
        if path.is_dir():
            total = sum(
                p.stat().st_size
                for p in path.rglob("*")
                if p.is_file() and not p.is_symlink()
            )
            kept = (
                [p.name for p in path.iterdir() if p.is_dir()]
                if label == "run folders"
                else []
            )
            print(
                f"  {label} {path}: {human(total)}"
                + (f" in {len(kept)} kept folder(s)" if kept else "")
            )
    return report()


def report() -> int:
    section("Summary")
    if findings:
        for text in findings:
            print(f"  ! {text}")
    else:
        print("  nothing to flag")
    return 0


if __name__ == "__main__":
    sys.exit(main())
