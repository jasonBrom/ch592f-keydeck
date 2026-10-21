# 来源与第三方组件

| 内容 | 来源 / 许可位置 | 整理说明 |
| --- | --- | --- |
| 原项目与本地功能基线 | [立创项目](https://diy.szlcsc.com/p/xhcx/project_fgiwwrct)，原交付包 `C5-RevE` | 此仓库以本地 1.15 源码为基线整理；未将复刻内容声明为原创 |
| WCH CH592 SDK | [openwch/ch592](https://github.com/openwch/ch592)，固定提交 `a46e0086f1ffb5e5502703970bff94888e67f4cb` | 保留 `firmware/vendor/ch592/LICENSE`（Apache 2.0）及各文件 WCH 声明；厂商 BLE / ISP 二进制库不声称已公开源码 |
| Three.js 及示例模块 | `web/public/THREE-LICENSE.txt`，MIT | 本地保留许可证，不依赖外部 CDN |
| PCB / 外壳与器件展示数据 | 从原交付包网页资源继承 | 三维展示为工程示意，原始模型的独立授权需由作者核对；仓库不另行声明原创或重授权 |
| 实物项目封面 | 用户提供照片为参考生成的封面，沿用前次文档交付 | `docs/images/cover.png`；仅作项目介绍，不作 PCB 丝印验收证据 |

原交付包涉及的上游电路、固件和模型应在作者确认后补充完整来源及适用范围。此次未以猜测填入作者名、版权归属或统一许可证。WCH SDK 保持原样，并由 `firmware/vendor/SHA256SUMS.txt` 检查。

开发时可选用 Prettier 3.6.2（MIT）格式化网页源码。它不进入网页产物，安装后许可位于 `web/node_modules/prettier/LICENSE`。
