#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export CC="${HOST_CC:-cc}"
mkdir -p build/native
"$CC" -DC5_ADVANCED_HAPTICS -std=c11 -Wall -Wextra -Werror -Iinclude core/config.c core/haptic.c tests/haptic_test.c -o build/native/haptic_test
build/native/haptic_test
"$CC" -DC5_ADVANCED_HAPTICS -std=c11 -Wall -Wextra -Werror -Iboard/tests -Iinclude -Iboard board/tests/test_haptic.c -o build/native/haptic_driver_test
build/native/haptic_driver_test
"$CC" -DC5_ADVANCED_HAPTICS -DC5_MOTOR_SOUND -std=c11 -Wall -Wextra -Werror -Iboard/tests -Iinclude -Iboard board/tests/test_haptic.c -o build/native/motor_sound_driver_test
build/native/motor_sound_driver_test
"$CC" -DC5_ADVANCED_HAPTICS -DC5_HAPTIC_CALIBRATION -std=c11 -Wall -Wextra -Werror -Iboard/tests -Iinclude -Iboard core/config.c board/tests/test_haptic.c -o build/native/calibration_driver_test
build/native/calibration_driver_test
bash tests/run_core_tests.sh
bash tests/run_ble_features_tests.sh
"$CC" -std=c11 -Wall -Wextra -Werror -Iinclude -Ifeatures features/hid_features.c features/test_features.c -o build/native/features_test
build/native/features_test
"$CC" -DC5_REPORT_RATES -std=c11 -Wall -Wextra -Werror -Iinclude -Iplatform/ch592 platform/ch592/reconfigure.c platform/ch592/tests/test_rates.c -o build/native/rate_test
build/native/rate_test
"$CC" -std=gnu11 -Wall -Wextra -Werror -Iplatform/ch592/tests/usb_mock -Ivendor/ch592/EVT/EXAM/SRC/StdPeriphDriver/inc -Iinclude -Ifeatures -Iplatform/ch592 platform/ch592/tests/test_usb_rates.c -o build/native/usb_rate_test
build/native/usb_rate_test
"$CC" -std=c11 -Wall -Wextra -Werror -Iboard/tests -Iinclude board/storage.c board/tests/test_storage.c -o build/native/storage_test
build/native/storage_test
"$CC" -std=c11 -Wall -Wextra -Werror -Iboard board/tests/test_clock.c -o build/native/clock_test
build/native/clock_test
"$CC" -std=c11 -Wall -Wextra -Werror -Iboard board/tests/test_encoder.c -o build/native/encoder_test
build/native/encoder_test
"$CC" -std=c11 -Wall -Wextra -Werror -Iboard board/tests/test_pairing.c -o build/native/pairing_test
build/native/pairing_test
"$CC" -std=c11 -Wall -Wextra -Werror -ffunction-sections -fdata-sections -Wl,--gc-sections -Iplatform/ch592/tests/ble_mock -Iinclude -Ifeatures -Iboard -Iplatform/ch592 -Ivendor/ch592/EVT/EXAM/BLE/LIB platform/ch592/tests/test_handoff.c -o build/native/handoff_test
build/native/handoff_test
"$CC" -std=c11 -Wall -Wextra -Werror -Iboard/tests/encoder_mock -Iinclude -Iboard board/tests/test_encoder_irq.c -o build/native/encoder_irq_test
build/native/encoder_irq_test
"$CC" -DC5_SMOOTH_RADIAL -std=c11 -Wall -Wextra -Werror -Iboard/tests/encoder_mock -Iinclude -Iboard board/tests/test_encoder_irq.c -o build/native/smooth_encoder_irq_test
build/native/smooth_encoder_irq_test
"$CC" -DC5_WINDOWS_FEATURES -DC5_SMOOTH_RADIAL -std=c11 -Wall -Wextra -Werror -ffunction-sections -fdata-sections -Wl,--gc-sections -Iinclude -Ifeatures core/config.c core/core.c features/hid_features.c tests/smooth_radial_test.c -o build/native/smooth_radial_test
build/native/smooth_radial_test
"$CC" -std=c11 -Wall -Wextra -Werror -Iinclude tests/relative_report_test.c -o build/native/relative_report_test
build/native/relative_report_test
"$CC" -std=c11 -Wall -Wextra -Werror -ffunction-sections -fdata-sections -Wl,--gc-sections -Iplatform/ch592/tests/ble_mock -Iinclude -Ifeatures -Iboard -Iplatform/ch592 -Ivendor/ch592/EVT/EXAM/BLE/LIB platform/ch592/tests/test_ble_input.c -o build/native/ble_input_test
build/native/ble_input_test
python3 features/compact_report_map.py --check
python3 scripts/check_hid_descriptors.py > build/HID_DESCRIPTOR_CHECK.json
"$CC" -DC5_NO_HAPTICS -DC5_ADVANCED_HAPTICS -DC5_WINDOWS_FEATURES -DC5_SMOOTH_RADIAL -std=c11 -Wall -Wextra -Werror -Iboard/tests -Iinclude -Iboard -Ifeatures core/config.c core/core.c core/haptic.c board/drv2605.c features/hid_features.c tests/no_haptic_test.c -o build/native/no_haptic_test
build/native/no_haptic_test
python3 features/compact_report_map.py --no-haptic --check
python3 scripts/check_hid_descriptors.py --no-haptic > build/NO_HAPTIC_DESCRIPTOR_CHECK.json
