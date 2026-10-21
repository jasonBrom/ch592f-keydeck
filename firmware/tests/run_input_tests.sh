#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
mkdir -p build/native
CC="${HOST_CC:-cc}"
"$CC" -std=c11 -Wall -Wextra -Werror -Iboard/tests/encoder_mock -Iinclude -Iboard board/tests/test_encoder_irq.c -o build/native/encoder_irq_test
build/native/encoder_irq_test
"$CC" -DC5_SMOOTH_RADIAL -std=c11 -Wall -Wextra -Werror -Iboard/tests/encoder_mock -Iinclude -Iboard board/tests/test_encoder_irq.c -o build/native/smooth_encoder_irq_test
build/native/smooth_encoder_irq_test
"$CC" -std=c11 -Wall -Wextra -Werror -Iinclude tests/relative_report_test.c -o build/native/relative_report_test
build/native/relative_report_test
"$CC" -std=c11 -Wall -Wextra -Werror -ffunction-sections -fdata-sections -Wl,--gc-sections -Iplatform/ch592/tests/ble_mock -Iinclude -Ifeatures -Iboard -Iplatform/ch592 -Ivendor/ch592/EVT/EXAM/BLE/LIB platform/ch592/tests/test_ble_input.c -o build/native/ble_input_test
build/native/ble_input_test
python3 features/compact_report_map.py --check
python3 scripts/check_hid_descriptors.py > build/HID_DESCRIPTOR_CHECK.json
