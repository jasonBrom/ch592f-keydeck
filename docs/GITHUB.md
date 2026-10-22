# 推送仓库并启用网页

建议仓库名称：`ch592f-keydeck`。描述：`基于 CH592F 的五键旋钮小键盘，支持 USB/BLE、网页改键、宏、RGB 与可选触觉反馈。`

远程仓库已创建：[jasonBrom/ch592f-keydeck](https://github.com/jasonBrom/ch592f-keydeck)。本地目录已初始化 Git，并绑定 `origin`。代码已推送到 `main`，Pages 已采用 GitHub Actions 发布并启用 HTTPS。

## 推送

本仓库已完成首次提交与推送。后续修改在本地 `ch592f-keydeck` 目录提交并推送即可，下面保留通用操作步骤。

在本目录打开终端，执行：

```sh
git add .
git commit -m "Describe your changes"
git push -u origin main
```

如果从 ZIP 解压出全新目录，先运行 `git init -b main` 和 `git remote add origin https://github.com/jasonBrom/ch592f-keydeck.git`，再执行上面的提交与推送命令。先在 GitHub 设置好自己的身份验证，命令不会保存或生成访问令牌。

## Pages 部署

本仓库已完成以下配置；Fork 到其他仓库时可按此启用：

1. 打开仓库 **Settings → Pages**。
2. **Build and deployment → Source** 选择 **GitHub Actions**。
3. 打开 **Actions → Deploy console to GitHub Pages**，等待完成；若首次推送早于 Pages 设置，点击 **Run workflow** 重跑。
4. 访问部署任务给出的链接，一般是 `https://jasonbrom.github.io/ch592f-keydeck/`。

部署会从当前提交编译两种固件、更新下载文件、检查网页资源，再发布 `web/dist/`。Python、本地依赖、固件源码、测试与日志不会进入网页部署产物。

仓库名可以变化：页面采用相对 URL，支持 GitHub 项目子目录。默认部署分支是 `main`；如果使用其他分支，修改 `pages.yml` 的分支过滤并核对 Pages 环境规则。

GitHub Free 可为公开仓库提供 Pages；私有仓库的可用性取决于账号计划。参考 [GitHub 官方工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 在线连接

在支持 WebHID / Web Bluetooth 的桌面 Chrome / Edge 中打开 HTTPS 页面，点击设备选择并授权。USB 需数据线；蓝牙设备需要正常运行支持配置服务的固件。切勿为了网页连接把正常 HID 接口换成 WinUSB。

Windows 已配对蓝牙服务在用户电脑本地运行，GitHub Pages 不运行 Python。需要该连接方式时，下载仓库并运行 `web/StartConsole.cmd`。可使用 `localhost:8792`，也可留在在线页，在「手动选择」点击「Windows 已配对」。在线页仅在明确点击后请求本机服务；如浏览器询问本机网络访问，请允许。服务只接受本地控制台和官方 HTTPS Origin 的限定 API 请求，不开放任意来源。

## 固件自动编译与发布

日常推送分支和提交 PR 会运行 **Verify web and firmware**，分别构建带震动、无震动两版，编译文件可从该次运行的 Artifacts 下载。

**Build and release firmware** 负责公开下载，复用同一套 CI。网页与 Python 测试、发布打包测试、SDK 哈希、固件主机测试和 C / JS 交叉测试通过后，才执行双版本编译和发布。两版缺少任何一个产物都会停止，不会拿仓库中的旧镜像补位。

### 发布版本标签

1. 检查源码中的版本：`web/package.json` 与 `firmware/platform/ch592/ble_transport.c` 的版本必须一致；升级固件时也应同步设备 INFO 版本字段及网页版本提示。
2. 提交并推送源码，再推送对应标签。例如当前版本为 `1.15.0`：

```sh
git tag -a v1.15.0 -m "KeyDeck CH592F 1.15.0"
git push origin v1.15.0
```

3. 打开 [Build and release firmware](https://github.com/jasonBrom/ch592f-keydeck/actions/workflows/firmware-release.yml)，等待 `prepare → verify → package → publish` 完成。
4. 在 [Releases](https://github.com/jasonBrom/ch592f-keydeck/releases) 下载。`vX.Y.Z` 为正式发布；`vX.Y.Z-rc.1` 这类标签自动标记为 Pre-release，不替换正式版的 Latest。

标签必须与代码中的基础版本匹配。已经使用的正式标签和附件应保留；新版本使用新标签，重跑不会覆盖已公开的附件。

### 不打标签，手动编译发布

进入该工作流，选择 **Run workflow** 和目标分支，`tag` 留空即可。工作流生成 `v<基础版本>-dev.<运行序号>.<提交前8位>` 形式的标签并发布开发版，保留每次构建来源，也不会替换正式版 Latest。

如果需要重跑已有标签的发布，在 `tag` 填入该标签。这个值按 Git 引用检出，不能用它给当前分支随意声明另一个正式版本。上传失败的草稿可在重跑时继续完成；已经公开的版本不会改写。

### 下载与校验

- `KeyDeck-CH592F-haptic.hex/.bin`：带 DRV2605L + AAC0809 LRA 硬件。
- `KeyDeck-CH592F-no-haptic.hex/.bin`：未装震动组件的硬件。
- 两个版本各自的 ZIP：包含 HEX、BIN、ELF、MAP、完整构建清单与烧录说明。
- `manifest.json`：源码提交、Actions 记录、SDK、工具链和各文件哈希。
- `SHA256SUMS.txt`：所有下载附件的 SHA-256。

下载全部附件后，可运行 `sha256sum --check SHA256SUMS.txt`。Windows 可用 `Get-FileHash 文件名 -Algorithm SHA256` 逐个核对。烧录方式见 [固件说明](../firmware/README.md#烧录)。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`；测试、编译和打包只读，最终发布任务单独申请 `contents: write`，无需新增 PAT 或其他 Secret。实现依据 [GitHub 可复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) 与 [GITHUB_TOKEN 权限说明](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)。

## 发布前需要作者决定

自有代码的统一开源许可证尚未指定。确认后替换 `LICENSE.md`；第三方组件与资源仍遵守其原许可证，不应批量改写为统一授权。
