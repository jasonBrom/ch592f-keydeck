# USB and BLE Windows HID features

`hid_features.c` supplies a five-lamp native HID LampArray and a Click-only Simple
Haptic Controller inside the Radial Controller. The transport owns report IDs and
USB control transfer framing; this module consumes payloads only. Both transports
carry the native HID LampArray and Radial haptic reports. BLE uses standard HOGP
Report characteristics and Report Reference descriptors, not the webpage
configuration service. System recognition still requires physical Windows tests.

| ID | Feature bytes | Output bytes | Function |
| --- | ---: | ---: | --- |
| 05 | 9 | 2 | Radial haptic controller |
| 10 | 22 | — | LampArray attributes |
| 11 | 2 | — | Select lamp attributes |
| 12 | 28 | — | Selected lamp attributes |
| 13 | 50 | — | Eight-slot multi update |
| 14 | 9 | — | Inclusive range update |
| 15 | 1 | — | Autonomous mode |

Haptics feature: `[auto ordinal, associated-control u32, intensity, click ordinal,
duration u16]`; duration is 18 milliseconds, matching the board HAL. Output is
`[ordinal, intensity]`. Ordinal 1 is None, 2 Stop, 3 Click; 0 is the null/manual
no-op and disables autonomous triggering in a feature write. Read-only attributes
cannot be overwritten by host feature writes. Unsupported, malformed, or hardware
failed requests return false for USB STALL or an ATT error response.

Lamp positions come from Rev.E D2..D6 CPL coordinates (Y flipped to the rear-left
origin required by HID); dimensions are the PCB
65.6 × 51.6 × 1.6 mm envelope. Lamp attributes use micrometers and microseconds.
RGB and intensity channel levels are 255 (255 nonzero levels plus off). Per-key
input binding is undefined because mappings are user-programmable. The independent
status LED D7 is deliberately outside the LampArray.

Call `c5_features_lights(rgb)` after local brightness/idle rendering and before
the board HAL, on every render. Host mode replaces RGB and bypasses local effects;
autonomous mode records actual colors so host acquisition freezes the last state.
Staging is separate from visible colors until UpdateComplete. Every slot is
validated before a multi update mutates staging; duplicate or invalid IDs reject
the entire update. Each transport has independent staged/visible lamp colors,
attribute cursor, autonomous mode and haptic defaults. `link_source(1, ready)`
updates USB; `link_source(2, ready)` updates BLE. BLE readiness means encrypted and
awake; it does not require a subscribed input CCC. Disconnect/suspend clears only
that source and stops its active haptic effect. The board HAL owns the 18ms timeout.

Ownership follows the configured transport preference: automatic mode gives USB
priority, then BLE; forced USB/BLE has no fallback. An inactive host may update its
retained lamp and automatic-haptic settings. Manual haptic output from an inactive
source returns an error and cannot interrupt the active host. Returning to that
source restores its retained settings; losing USB does not reset connected BLE.
The feature layer uses 84 bytes of static state and no heap.

The shared USB/BLE Report Map is **508 bytes**, under ATT's fixed 512-byte attribute
limit. `compact_report_map.py` generates `hid_compact_map.h` from the readable
macros by removing redundant globals, using equivalent usage ranges, reordering
whole top-level collections, and adding one Global PUSH/POP pair. Its comparison
checks every report's ID, type, bit offset, collection path, usage ordering,
logical/physical ranges, units, field sizes and counts.

BLE transport helper `platform/ch592/ble_features.c` snapshots each full Feature
GET once and handles Read Blob offsets. At MTU 23 the 50-byte report reads as
22+22+6 bytes; reading the 28-byte lamp-attributes report advances the lamp cursor
only once. Writes use Write Request or Prepare/Execute Write. The pinned WCH SDK
queues on-wire prepares; its execute callback supplies a complete contiguous
value or replays fragments. The helper checks coverage/overlaps before the final
SET, rejects mixed-report transactions, and does nothing on cancellation. SET
runs in TMOS main context, so the actual haptic result precedes the ATT response.
No larger negotiated MTU is assumed.

Native verification (run from `firmware`):

```sh
cc -std=c11 -Wall -Wextra -Werror -Iinclude -Ifeatures features/hid_features.c features/test_features.c -o /tmp/c5-features-test
/tmp/c5-features-test
python3 features/compact_report_map.py --check
sh tests/run_ble_features_tests.sh
```

Do not include `test_features.c` in the embedded build; it defines a test HAL and
`main`. Windows recognition, ownership transitions, effect strength, and USB
Feature transfers and BLE default-MTU writes still require physical Windows
validation. Windows 11 Settings Dynamic Lighting is distinct from foreground
LampArray application control available on older Windows versions.

After upgrading older firmware, remove the old C5 Rev.E Bluetooth pairing in
Windows, power-cycle the device, and pair again. USB should be unplugged/replugged.
The firmware registers the SDK GATT service but currently does not send Service
Changed indications for a database-version migration. A changed device name or
firmware revision alone does not guarantee Windows refreshes cached HID reports.

Sources:

- <https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/dynamic-lighting-devices>
- <https://github.com/microsoft/ArduinoHidForWindows>
- <https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/radial-controller-feature-reports>
- <https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/radial-controller-output-reports>
- <https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/input-haptics-implementation-guide>
- <https://www.usb.org/sites/default/files/hut1_4.pdf> (sections 17 and 26)

- <https://www.bluetooth.com/specifications/specs/human-interface-device-service-1-0/>
- <https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core-54/out/en/host/generic-attribute-profile--gatt-.html> (sections 2.5.2, 4.8.3, 4.9.4, 5.2.1)
- <https://github.com/openwch/ch592> (pinned SDK `CH59xBLE_LIB.h`, GATT callback contract)
