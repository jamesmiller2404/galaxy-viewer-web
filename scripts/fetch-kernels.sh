#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPICE_DIR="$ROOT_DIR/data/spice"

INCLUDE_IRREGULAR=0
for arg in "$@"; do
  if [[ "$arg" == "--include-irregular" ]]; then
    INCLUDE_IRREGULAR=1
  fi
done

mkdir -p \
  "$SPICE_DIR/lsk" \
  "$SPICE_DIR/pck" \
  "$SPICE_DIR/spk/planets" \
  "$SPICE_DIR/spk/jupiter" \
  "$SPICE_DIR/fk"

download() {
  local url="$1"
  local dest="$2"
  if [[ -f "$dest" ]]; then
    echo "skip: $dest"
    return
  fi
  echo "fetch: $url"
  curl -L --retry 3 --retry-delay 1 -o "$dest" "$url"
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $2}'
    return
  fi
  echo "sha256 tool not found" >&2
  return 1
}

verify_checksum() {
  local base_url="$1"
  local file_name="$2"
  local dest="$3"
  local checksums
  checksums="$(mktemp)"
  curl -L --retry 3 --retry-delay 1 -o "$checksums" "$base_url/aa_checksums.txt"
  local expected
  expected="$(grep " $file_name$" "$checksums" | awk '{print $1}' | head -n 1)"
  rm -f "$checksums"
  if [[ -z "$expected" ]]; then
    echo "checksum missing for $file_name" >&2
    return 1
  fi
  local actual
  actual="$(sha256_file "$dest")"
  if [[ "$expected" != "$actual" ]]; then
    echo "checksum mismatch for $file_name" >&2
    echo "expected: $expected" >&2
    echo "actual:   $actual" >&2
    return 1
  fi
  echo "ok: $file_name"
}

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls" \
  "$SPICE_DIR/lsk/naif0012.tls"
verify_checksum "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk" "naif0012.tls" \
  "$SPICE_DIR/lsk/naif0012.tls"

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc" \
  "$SPICE_DIR/pck/pck00011.tpc"
verify_checksum "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck" "pck00011.tpc" \
  "$SPICE_DIR/pck/pck00011.tpc"

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/earth_fixed.tf" \
  "$SPICE_DIR/pck/earth_fixed.tf"
verify_checksum "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck" "earth_fixed.tf" \
  "$SPICE_DIR/pck/earth_fixed.tf"

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/earth_latest_high_prec.bpc" \
  "$SPICE_DIR/pck/earth_latest_high_prec.bpc"
verify_checksum "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck" "earth_latest_high_prec.bpc" \
  "$SPICE_DIR/pck/earth_latest_high_prec.bpc"

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de442.bsp" \
  "$SPICE_DIR/spk/planets/de442.bsp"
verify_checksum "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets" "de442.bsp" \
  "$SPICE_DIR/spk/planets/de442.bsp"

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/jup365.bsp" \
  "$SPICE_DIR/spk/jupiter/jup365.bsp"
verify_checksum "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites" "jup365.bsp" \
  "$SPICE_DIR/spk/jupiter/jup365.bsp"

if [[ "$INCLUDE_IRREGULAR" == "1" ]]; then
  download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/jup347.cmt" \
    "$SPICE_DIR/fk/jup347.cmt"
  verify_checksum "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites" "jup347.cmt" \
    "$SPICE_DIR/fk/jup347.cmt"

  download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/jup347.bsp" \
    "$SPICE_DIR/spk/jupiter/jup347.bsp"
  verify_checksum "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites" "jup347.bsp" \
    "$SPICE_DIR/spk/jupiter/jup347.bsp"
fi
