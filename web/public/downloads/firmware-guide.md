# KeyDeck 固件

正式项目：基于CH592F的自定义小键盘。基于现有 1.15 平滑轮盘版本整理，使用同一份代码构建带震动和无震动两版。

## 构建环境

- Linux / WSL Ubuntu，GNU Make、GCC 主机编译器、Python 3。
- WCH MounRiver Studio 1.91 的 `riscv-none-embed-gcc` 8.2.0，支持 WCH 快速中断 ABI。
- WCH CH592 SDK 固定提交 `a46e0086f1ffb5e5502703970bff94888e67f4cb`，已随仓库提供所需子集。

```sh
cd firmware
bash scripts/fetch_sdk.sh
(cd vendor && sha256sum --check SHA256SUMS.txt)
bash scripts/fetch_toolchain.sh
make -j4 VARIANT=haptic CROSS_COMPILE="$HOME/.cache/c5-dial-tools/riscv-none-embed-gcc-8-linux-1.91/bin/riscv-none-embed-"
make -j4 VARIANT=no-haptic CROSS_COMPILE="$HOME/.cache/c5-dial-tools/riscv-none-embed-gcc-8-linux-1.91/bin/riscv-none-embed-"
```

输出分别位于 `build/haptic/` 与 `build/no-haptic/`，含 `.hex/.bin/.elf/.map`。两版使用独立目标目录，避免目标文件混用。修改编译选项时应清理相应构建目录；切换 `VARIANT` 本身无需清理。

另保留 CMake 备用配置，必须分别配置两个构建目录。本次本机验证使用 Make，未安装 CMake，因此未验证这一备用构建路径：

```sh
cmake -S . -B build/cmake-haptic -DCMAKE_TOOLCHAIN_FILE=scripts/riscv-wch.cmake -DKEYDECK_HAPTICS=ON
cmake --build build/cmake-haptic -j4
cmake -S . -B build/cmake-no-haptic -DCMAKE_TOOLCHAIN_FILE=scripts/riscv-wch.cmake -DKEYDECK_HAPTICS=OFF
cmake --build build/cmake-no-haptic -j4
```

CMake 使用 PATH 中的 `riscv-none-embed-*`，或按 `scripts/riscv-wch.cmake` 指定完整路径。

## 无震动版本的差异

`VARIANT=no-haptic` 定义 `C5_NO_HAPTICS`，不定义 `C5_HAPTIC_CALIBRATION`。

- `board/drv2605.c` 编译为空硬件后端，不设置 PB14/PB15，不发送 I²C，不校准或播放马达。
- INFO 新能力位 `0x800000` 表示无震动构建；清除本地高级触觉、校准和主机触觉能力位，保留配置层、平滑轮盘、灯光和其他能力。
- USB / BLE 的 HID Map 不包含触觉报告 ID `0x05`；BLE 不注册对应 Report 特征。两版描述符分别为 508 / 403 字节。
- 配置命令 `10`（脉冲）和 `14`（高级试听）返回 `C5_ERR_UNSUPPORTED`，不伪造播放成功。
- 保留 1024 字节配置格式及触觉预留区。迁移带震动版配置时，触觉字节被保留；网页不再等待无震动硬件的校准。

更换 HID 描述符后，操作系统可能缓存原 BLE 服务。必要时删除旧配对、断电并重新配对。

## 烧录

使用 WCH 官方 ISP 下载工具，选择 **CH592F**，优先载入 HEX。BIN 的应用起始地址为 `0x00000000`。

1. 按住 BOOT，复位或重新上电，进入 USB ISP。
2. 载入与硬件对应的 HEX。保留 DataFlash，不选择全片数据擦除。
3. 确认下载成功，松开 BOOT，再正常复位。
4. 连接控制台，读取配置，确认固件能力、按键、双向旋转和保存回读。

随包 ISP INI 是原工程配置参考，载入后需重新选择当前 HEX，不能盲用旧文件路径。芯片选项不由应用 BIN 自动写入：`CFG_RESET_EN=1`、`CFG_BOOT_EN=1`；带震动版需 `CFG_DEBUG_EN=0` 释放 PB14/PB15 给 I²C。具体以硬件和官方工具为准。

DataFlash 双配置槽偏移 `0x4000/0x5000`，蓝牙绑定区 `0x7000`。下载前建议导出 JSON 配置。

## 引脚

| 功能 | 引脚 |
| --- | --- |
| 按键 1 / 2 / 3 / 4 / 5 | PA4 / PA5 / PA12 / PB7 / PB12 |
| 编码器 A / B / 按压 | PA8 / PA9 / PB4 |
| DRV2605L SCL / SDA（可选） | PB15 / PB14 |
| 五键背光 / 状态灯 | PB13 / PA15 |
| 电池 ADC / 充电状态 | PA14 / PA13 |
| USB D+ / D− | PB11 / PB10 |
| RESET / BOOT | PB23 / PB22 |

## 验证与发布

GitHub 自动构建入口：[Build and release firmware](https://github.com/jasonBrom/ch592f-keydeck/actions/workflows/firmware-release.yml)，下载入口：[Releases](https://github.com/jasonBrom/ch592f-keydeck/releases)。推送与源码版本一致的 `vX.Y.Z` 标签后，先运行网页、服务、固件主机和交叉测试，再编译 `haptic` / `no-haptic`；两版均成功才发布。预发布标签如 `v1.15.0-rc.1` 自动标记为 Pre-release。

也可在该工作流点击 **Run workflow**：`tag` 留空会从所选分支发布独立的开发预发布；填写已有版本标签则重新执行对应发布。已公开的附件不会被重跑覆盖，未完成的草稿可继续上传。无需添加个人令牌，只有最后的发布任务申请仓库写入权限。完整流程见 [GitHub 发布说明](../docs/GITHUB.md#固件自动编译与发布)。

每次发布提供两个完整 ZIP、可单独下载的 HEX / BIN、`manifest.json`、`SHA256SUMS.txt` 和烧录说明。清单记录源码 SHA、SDK、工具链及四种构建文件的哈希；发布状态不替代实物验收。

本地验证与网页下载打包仍可使用：

```sh
bash scripts/verify_host.sh
bash tests/run_integration_tests.sh
cd ..
node scripts/package-release.mjs
```

本地打包脚本按 `web/package.json` 中的版本生成 `releases/<版本>/` 的两版 HEX/BIN 和 SHA-256，同时更新网页下载目录。修改描述符后运行并检查两份生成头：

```sh
python3 features/compact_report_map.py
python3 features/compact_report_map.py --no-haptic
python3 scripts/check_hid_descriptors.py
python3 scripts/check_hid_descriptors.py --no-haptic
```

本次整理的镜像通过编译与软件测试，尚未刷入对应实物验收。LRA 型号按 AAC0809 配置；不要直接替换为额定电压/频率不同的马达。深睡、USB 远程唤醒尚未实现，不能从闲置熄灯推断续航。
