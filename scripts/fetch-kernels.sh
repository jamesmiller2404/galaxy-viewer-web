#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPICE_DIR="$ROOT_DIR/data/spice"
CURL_BIN="${CURL_BIN:-curl}"

if [[ "$CURL_BIN" == "curl" ]] && command -v curl.exe >/dev/null 2>&1; then
  if [[ -n "${WSL_INTEROP-}" ]]; then
    CURL_BIN="curl.exe"
  fi
fi

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
  "$SPICE_DIR/fk" \
  "$SPICE_DIR/fk/planets"

curl_fetch() {
  set +e
  "$CURL_BIN" -L --retry 3 --retry-delay 1 "$@"
  local status=$?
  set -e
  return $status
}

curl_output_path() {
  local path="$1"
  if [[ "$CURL_BIN" == "curl.exe" ]] && command -v wslpath >/dev/null 2>&1; then
    wslpath -w "$path"
    return
  fi
  printf '%s\n' "$path"
}

download() {
  local url="$1"
  local dest="$2"
  echo "fetch: $url"
  local dest_out
  dest_out="$(curl_output_path "$dest")"
  if ! curl_fetch -f -o "$dest_out" "$url"; then
    echo "download failed: $url" >&2
    return 1
  fi
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

md5_file() {
  local file="$1"
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$file" | awk '{print $1}'
    return
  fi
  if command -v md5 >/dev/null 2>&1; then
    md5 -q "$file"
    return
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -md5 "$file" | awk '{print $2}'
    return
  fi
  echo "md5 tool not found" >&2
  return 1
}

verify_checksum() {
  
  local base_url="$1"
  local file_name="$2"
  local dest="$3"
  local checksums
  if [[ "$CURL_BIN" == "curl.exe" ]]; then
    checksums="$(mktemp "$SPICE_DIR/.checksums.XXXXXX")"
  else
    checksums="$(mktemp)"
  fi
  local checksums_out
  checksums_out="$(curl_output_path "$checksums")"
  if ! curl_fetch -f -o "$checksums_out" "$base_url/aa_checksums.txt"; then
    rm -f "$checksums"
    echo "checksum manifest missing at $base_url/aa_checksums.txt; skipping $file_name" >&2
    return 0
  fi
  if [[ ! -s "$checksums" ]]; then
    rm -f "$checksums"
    echo "checksum manifest missing at $base_url/aa_checksums.txt; skipping $file_name" >&2
    return 0
  fi
  if grep -qiE "<!doctype html|<html|not found" "$checksums"; then
    rm -f "$checksums"
    echo "checksum manifest missing at $base_url/aa_checksums.txt; skipping $file_name" >&2
    return 0
  fi
  local expected
  expected="$(awk -v name="$file_name" '$2 == name {print $1; exit}' "$checksums")"
  rm -f "$checksums"
  if [[ -z "$expected" ]]; then
    echo "checksum missing for $file_name" >&2
    return 1
  fi
  local actual
  if [[ ${#expected} -eq 32 ]]; then
    if ! actual="$(md5_file "$dest")"; then
      return 1
    fi
  elif [[ ${#expected} -eq 64 ]]; then
    if ! actual="$(sha256_file "$dest")"; then
      return 1
    fi
  else
    echo "unsupported checksum format for $file_name" >&2
    return 1
  fi
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

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc" \
  "$SPICE_DIR/pck/pck00011.tpc"

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/earth_fixed.tf" \
  "$SPICE_DIR/pck/earth_fixed.tf"

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/earth_latest_high_prec.bpc" \
  "$SPICE_DIR/pck/earth_latest_high_prec.bpc"

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de442.bsp" \
  "$SPICE_DIR/spk/planets/de442.bsp"

download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/jup365.bsp" \
  "$SPICE_DIR/spk/jupiter/jup365.bsp"

if [[ "$INCLUDE_IRREGULAR" == "1" ]]; then
  download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/jup347.cmt" \
    "$SPICE_DIR/fk/jup347.cmt"

  download "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/jup347.bsp" \
    "$SPICE_DIR/spk/jupiter/jup347.bsp"
fi
