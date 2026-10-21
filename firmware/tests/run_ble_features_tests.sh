#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build/native
${CC:-cc} -std=c99 -O1 -g -Wall -Wextra -Werror -pedantic \
 -fsanitize=address,undefined -fno-omit-frame-pointer \
 -Iinclude -Ifeatures -Iplatform/ch592 -Ivendor/ch592/EVT/EXAM/BLE/LIB \
 platform/ch592/ble_features.c tests/ble_features_test.c \
 -o build/native/ble_features_test
# This execution environment cannot run LeakSanitizer's ptrace thread scan.
ASAN_OPTIONS=detect_leaks=0 ./build/native/ble_features_test
