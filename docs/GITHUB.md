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

Windows 已配对蓝牙服务在用户电脑本地运行，GitHub Pages 不运行 Python。需要该连接方式时，下载仓库并运行 `web/StartConsole.cmd`，使用 `localhost:8792`。在线页不会尝试跨域访问本地服务。

## 发布前需要作者决定

自有代码的统一开源许可证尚未指定。确认后替换 `LICENSE.md`；第三方组件与资源仍遵守其原许可证，不应批量改写为统一授权。
