#!/usr/bin/env bash
set -euo pipefail
c5_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
c5_sdk="$c5_root/vendor/ch592"
c5_commit="a46e0086f1ffb5e5502703970bff94888e67f4cb"
if [[ -f "$c5_sdk/EVT/EXAM/BLE/LIB/LIBCH59xBLE.a" ]]; then
  printf 'Bundled SDK present. Verify vendor/SHA256SUMS.txt before building.\n'
  exit 0
fi
if [[ -d "$c5_sdk" ]]; then
  printf 'SDK directory exists but is incomplete: %s\n' "$c5_sdk" >&2
  exit 1
fi
mkdir -p "$c5_root/vendor"
git clone --filter=blob:none --no-checkout https://github.com/openwch/ch592.git "$c5_sdk"
git -C "$c5_sdk" sparse-checkout set EVT/EXAM/SRC EVT/EXAM/BLE/HAL EVT/EXAM/BLE/LIB
git -C "$c5_sdk" checkout --detach "$c5_commit"
