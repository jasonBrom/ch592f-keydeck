#!/usr/bin/env bash
set -euo pipefail
# Pinned WCH-compatible GCC build; archive retrieved from MounRiver community mirror.
# Set C5_TOOLS_DIR to reuse a user-managed toolchain cache.
c5_tools_dir="${C5_TOOLS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/c5-dial-tools}"
c5_archive="$c5_tools_dir/riscv-none-embed-gcc-8-linux-1.91.zip"
c5_release="riscv-none-embed-gcc-8-linux-1.91"
c5_sha="a8d24953b5194146409be434e4fb2bb33fc4648f7e556154bd4a5489ebaeca64"
c5_url="https://github.com/ch32-riscv-ug/MounRiver_Studio_Community_miror/releases/download/1.91-toolchain/riscv-none-embed-gcc-8-linux-1.91.zip"
mkdir -p "$c5_tools_dir"
if [[ ! -x "$c5_tools_dir/$c5_release/bin/riscv-none-embed-gcc" ]]; then
  if [[ ! -f "$c5_archive" ]]; then
    curl --fail --location --retry 3 "$c5_url" --output "$c5_archive.part"
    mv "$c5_archive.part" "$c5_archive"
  fi
  printf '%s  %s\n' "$c5_sha" "$c5_archive" | sha256sum --check
  unzip -q -o "$c5_archive" -d "$c5_tools_dir"
fi
"$c5_tools_dir/$c5_release/bin/riscv-none-embed-gcc" --version
printf '\nBuild using:\nmake CROSS_COMPILE=%q -j4\n' "$c5_tools_dir/$c5_release/bin/riscv-none-embed-"
