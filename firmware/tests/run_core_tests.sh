#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build/native
${CC:-cc} -std=c99 -O2 -Wall -Wextra -Werror -pedantic -Iinclude core/config.c core/core.c tests/core_test.c -o build/native/core_test
./build/native/core_test
${CC:-cc} -std=c99 -O2 -Wall -Wextra -Werror -pedantic -DC5_REPORT_RATES -Iinclude core/config.c core/core.c tests/core_test.c -o build/native/core_test_rates
./build/native/core_test_rates
${CC:-cc} -std=c99 -O2 -Wall -Wextra -Werror -pedantic -DC5_REPORT_RATES -DC5_BOARD_DIAGNOSTICS -Iinclude core/config.c core/core.c tests/core_test.c -o build/native/core_test_diagnostics
./build/native/core_test_diagnostics
${CC:-cc} -std=c99 -O2 -Wall -Wextra -Werror -pedantic -DC5_WINDOWS_FEATURES -DC5_REPORT_RATES -Iinclude -Ifeatures core/config.c core/core.c features/hid_features.c tests/core_test.c -o build/native/core_test_windows
./build/native/core_test_windows
