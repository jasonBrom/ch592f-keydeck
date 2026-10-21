#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build/native
${CC:-cc} -std=c99 -O1 -g -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer -DC5_REPORT_RATES -Iinclude core/config.c core/core.c tests/integration_bridge.c -o build/native/integration_bridge
# LeakSanitizer cannot enumerate threads in this managed ptrace environment.
# AddressSanitizer and UndefinedBehaviorSanitizer stay enabled.
ASAN_OPTIONS=detect_leaks=0 node tests/integration_test.mjs
${CC:-cc} -std=c11 -O1 -g -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -DC5_ADVANCED_HAPTICS -DC5_HAPTIC_CALIBRATION -Iinclude core/config.c core/core.c core/haptic.c tests/integration_bridge.c -o build/native/haptic_integration_bridge
ASAN_OPTIONS=detect_leaks=0 node tests/haptic_integration_test.mjs
ASAN_OPTIONS=detect_leaks=0 node tests/calibration_integration_test.mjs
${CC:-cc} -std=c11 -O1 -g -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -DC5_ADVANCED_HAPTICS -DC5_MOTOR_SOUND -Iinclude core/config.c core/core.c core/haptic.c core/motor_sound.c tests/integration_bridge.c -o build/native/motor_sound_integration_bridge
ASAN_OPTIONS=detect_leaks=0 node tests/motor_sound_integration_test.mjs
${CC:-cc} -std=c11 -O1 -g -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -DC5_ADVANCED_HAPTICS -DC5_HAPTIC_CALIBRATION -DC5_SMOOTH_RADIAL -Iinclude core/config.c core/core.c core/haptic.c tests/integration_bridge.c -o build/native/smooth_integration_bridge
ASAN_OPTIONS=detect_leaks=0 node tests/smooth_integration_test.mjs
