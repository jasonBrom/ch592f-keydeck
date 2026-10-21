# WCH vendor components

Official source: https://github.com/openwch/ch592
Pinned commit: `a46e0086f1ffb5e5502703970bff94888e67f4cb`.
BLE ABI/header identifies `CH59x_BLE_LIB_V1.4`.

The distributable package contains exactly the official `EVT/EXAM/SRC`,
`EVT/EXAM/BLE/HAL`, and `EVT/EXAM/BLE/LIB` trees plus repository README/LICENSE.
The source files remain unmodified; compile definitions choose this board's
external 32768 Hz crystal, internal DCDC, and BLE connection/memory settings.
`SHA256SUMS.txt` identifies all bundled files. Run `sha256sum -c SHA256SUMS.txt`
from this directory to verify them. The BLE protocol and ISP libraries are
vendor-provided binary archives; this project does not claim their source is open.
Preserve the repository license and each file's WCH MCU-use copyright notice.
