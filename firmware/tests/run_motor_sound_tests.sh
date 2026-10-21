#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build/native
${CC:-cc} -std=c11 -Wall -Wextra -Werror -DC5_ADVANCED_HAPTICS -DC5_MOTOR_SOUND -Iinclude core/motor_sound.c tests/motor_sound_test.c -o build/native/motor_sound_test
build/native/motor_sound_test
${CC:-cc} -std=c11 -Wall -Wextra -Werror -DC5_ADVANCED_HAPTICS -DC5_MOTOR_SOUND -Iboard/tests -Iinclude -Iboard board/tests/test_haptic.c -o build/native/motor_sound_driver_test
build/native/motor_sound_driver_test
${CC:-cc} -std=c11 -Wall -Wextra -Werror -DC5_ADVANCED_HAPTICS -DC5_MOTOR_SOUND -DC5_REPORT_RATES -Iinclude core/config.c core/core.c core/haptic.c core/motor_sound.c tests/integration_bridge.c -o build/native/motor_sound_integration_bridge
"${NODE:-node}" tests/motor_sound_integration_test.mjs
