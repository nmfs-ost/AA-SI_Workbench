#!/usr/bin/env bash
# Move file-by-file stores out of the per_file/ level of the bucket.
#
#   bash move_per_file_stores.sh gs://BUCKET/derived_products/YOU/            # look, change nothing
#   bash move_per_file_stores.sh gs://BUCKET/derived_products/YOU/ --apply    # move
#
# Before catch-up 15 the Workbench put each raw file's EchoData store in
#   derived_products/YOU/<vessel>/<survey>/per_file/<echosounder>/<file>.zarr
# and now puts it (and its Sv) in
#   derived_products/YOU/<vessel>/<survey>/<echosounder>/<file>.zarr
# Moved, they are found there and reused; left, they are made again.
#
# Given a prefix, it finds every <vessel>/<survey>/per_file/<echosounder>/ below it
# (or give those folders themselves). Without --apply it only lists what it would
# move and stops. With --apply, for each folder:
#   1. refuses if anything of the same name is already in the new folder;
#   2. copies every store and record into the new folder, inside the bucket
#      (nothing is downloaded; object metadata, such as the product hash on each
#      store's root, is copied with it);
#   3. checks every object arrived, with its size;
#   4. only then deletes the per_file/ copy.
# Run it when no Prepare is running. Running it again picks up where it stopped.
set -euo pipefail

APPLY=0
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    gs://*) TARGETS+=("$arg") ;;
    *) echo "move_per_file_stores.sh: not a gs:// prefix: $arg" >&2; exit 2 ;;
  esac
done
[ "${#TARGETS[@]}" -gt 0 ] || { sed -n '2,24p' "$0"; exit 2; }

if command -v gcloud >/dev/null 2>&1; then
  ls_()  { gcloud storage ls "$@"; }
  cpr_() { gcloud storage cp -r "$1" "$2"; }
  rmr_() { gcloud storage rm -r "$1"; }
  # An object's aa-* custom metadata, one "key value" per line, sorted.
  meta_() { local j; j="$(gcloud storage objects describe "$1" --format=json)" || return 1
            printf '%s\n' "$j" | { grep -o '"aa-[^"]*": *"[^"]*"' || true; } | tr -d '"' | tr -s ' ' | LC_ALL=C sort; }
elif command -v gsutil >/dev/null 2>&1; then
  ls_()  { gsutil ls "$@"; }
  cpr_() { gsutil -m cp -r "$1" "$2"; }
  rmr_() { gsutil -m rm -r "$1"; }
  meta_() { local j; j="$(gsutil stat "$1")" || return 1
            printf '%s\n' "$j" | { grep -E '^[[:space:]]+aa-[^:]+:' || true; } | sed -E 's/^[[:space:]]+//; s/:[[:space:]]+/: /' | LC_ALL=C sort; }
else
  echo "move_per_file_stores.sh: needs gcloud (or gsutil)." >&2; exit 1
fi

# Every object below a folder, as "<size> <path relative to it>", sorted.
inventory() {
  local root="$1" out
  out="$(ls_ -r -l "$root")" || return 1
  printf '%s\n' "$out" | awk -v root="$root" '$1 ~ /^[0-9]+$/ && index($3, root) == 1 &&
    length($3) > length(root) { print $1, substr($3, length(root) + 1) }' | LC_ALL=C sort
}

human() { awk -v b="$1" 'BEGIN { split("B KB MB GB TB", u); i = 1;
  while (b >= 1000 && i < 5) { b /= 1000; i++ } printf "%.1f %s", b, u[i] }'; }

# The per_file/<echosounder>/ folders to move.
FOLDERS=()
for target in "${TARGETS[@]}"; do
  target="${target%/}/"
  case "$target" in
    */per_file/*/) FOLDERS+=("$target") ;;
    *)
      # A user's folder (vessel/survey below it), a vessel's, or a survey's.
      for pattern in "${target}*/*/per_file/" "${target}*/per_file/" "${target}per_file/"; do
        while IFS= read -r line; do
          case "$line" in gs://*/per_file/*/) FOLDERS+=("$line") ;; esac
        done < <(ls_ "$pattern" 2>/dev/null || true)
      done
      ;;
  esac
done
if [ "${#FOLDERS[@]}" -gt 0 ]; then
  mapfile -t FOLDERS < <(printf '%s\n' "${FOLDERS[@]}" | LC_ALL=C sort -u)
fi
if [ "${#FOLDERS[@]}" -eq 0 ]; then
  echo "No per_file/ folders found below ${TARGETS[*]}: nothing to move."
  echo "(If you expected some, check that this account can list the bucket: ls_ ${TARGETS[0]})" \
    | sed 's/ls_ /gcloud storage ls /'
  exit 0
fi

status=0
for src in "${FOLDERS[@]}"; do
  dst="${src/\/per_file\//\/}"
  mapfile -t items < <(ls_ "$src" | awk -v s="$src" 'index($0, s) == 1 && length($0) > length(s) && !/:$/')
  if [ "${#items[@]}" -eq 0 ]; then
    echo "$src: empty (already moved?)"
    continue
  fi
  stores=0; records=0
  for item in "${items[@]}"; do
    case "$item" in */) stores=$((stores + 1)) ;; *.aa.json) records=$((records + 1)) ;; esac
  done
  if ! inv_src="$(inventory "$src" 2>/dev/null)" || [ -z "$inv_src" ]; then
    echo "$src: SKIPPED, could not list it"; status=1; continue
  fi
  objects=$(printf '%s\n' "$inv_src" | grep -c . || true)
  bytes=$(printf '%s\n' "$inv_src" | awk '{ s += $1 } END { print s + 0 }')
  echo "$src"
  echo "  -> $dst"
  echo "  $stores stores, $records records ($objects objects, $(human "$bytes"))"

  # Nothing of the same name may already be in the new folder, except what an
  # earlier run of this script copied there before it stopped: every object of
  # it one of these, with the same size.
  existing="$(ls_ "$dst" 2>/dev/null | grep '^gs://' | awk -v d="$dst" 'index($0, d) == 1 { print substr($0, length(d) + 1) }' || true)"
  inv_dst="$(inventory "$dst" 2>/dev/null || true)"
  clash=(); foreign=()
  for item in "${items[@]}"; do
    name="${item#"$src"}"
    if printf '%s\n' "$existing" | grep -qxF -- "$name"; then
      clash+=("$name")
      extra="$(LC_ALL=C comm -13 \
        <(printf '%s\n' "$inv_src" | awk -v n="$name" 'index($2, n) == 1') \
        <(printf '%s\n' "$inv_dst" | awk -v n="$name" 'index($2, n) == 1') | grep . || true)"
      [ -z "$extra" ] || foreign+=("$name")
    fi
  done
  if [ "${#foreign[@]}" -gt 0 ]; then
    echo "  REFUSED: already in $dst, and not a copy of these: ${foreign[*]:0:5}$([ ${#foreign[@]} -gt 5 ] && echo …)"
    echo "  (made there since; leave this folder, or delete one copy by hand)"
    status=1
    continue
  fi
  if [ "${#clash[@]}" -gt 0 ]; then
    echo "  ${#clash[@]} already partly copied by an earlier run: carrying on"
  fi
  if [ "$APPLY" -eq 0 ]; then
    echo "  would move them (run again with --apply)"
    continue
  fi

  for item in "${items[@]}"; do
    # Into the new folder, under its own name (a store with all it holds).
    cpr_ "${item%/}" "$dst" >/dev/null 2>&1 || cpr_ "${item%/}" "$dst"
  done
  # Every object arrived, with its size, before anything is deleted.
  inv_dst="$(inventory "$dst" 2>/dev/null || true)"
  missing="$(LC_ALL=C comm -23 <(printf '%s\n' "$inv_src") <(printf '%s\n' "$inv_dst") | grep . || true)"
  if [ -n "$missing" ]; then
    echo "  NOT DELETED: $(printf '%s\n' "$missing" | grep -c .) object(s) did not arrive as they are, e.g.:"
    printf '%s\n' "$missing" | head -3 | sed 's/^/    /'
    status=1
    continue
  fi
  # Each store's root object carries its product hash (aa-product-hash), which
  # is how the tools know the store is finished: it must have come along.
  lost=()
  for item in "${items[@]}"; do
    case "$item" in */) ;; *) continue ;; esac
    name="${item#"$src"}"
    for root in zarr.json .zattrs; do
      if printf '%s\n' "$inv_src" | awk '{ print $2 }' | grep -qxF -- "$name$root"; then
        if ! m1="$(meta_ "$src$name$root" 2>/dev/null)" || ! m2="$(meta_ "$dst$name$root" 2>/dev/null)" || [ "$m1" != "$m2" ]; then
          lost+=("$name")
        fi
        break
      fi
    done
  done
  if [ "${#lost[@]}" -gt 0 ]; then
    echo "  NOT DELETED: the aa- metadata of ${#lost[@]} store(s) did not come along, e.g. ${lost[0]}"
    echo "  (the copies would not be recognised; nothing was deleted)"
    status=1
    continue
  fi
  if [ "$(inventory "$src" 2>/dev/null || echo FAILED)" != "$inv_src" ]; then
    echo "  NOT DELETED: $src changed since it was listed, or could not be listed again"; status=1; continue
  fi
  rmr_ "$src" >/dev/null 2>&1 || rmr_ "$src"
  echo "  moved: $objects objects checked in $dst; $src deleted"
done
if [ "$APPLY" -eq 0 ]; then
  echo "Nothing was changed. Run again with --apply to move."
fi
exit "$status"
