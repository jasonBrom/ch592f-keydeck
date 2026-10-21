# GitHub Pages 部署记录

2026-10-21，代码已推送到 [jasonBrom/ch592f-keydeck](https://github.com/jasonBrom/ch592f-keydeck) 的 `main` 分支，并通过自定义 GitHub Actions 发布。

**在线控制台：<https://jasonbrom.github.io/ch592f-keydeck/>**

## 首次上线验证

| 检查         | 结果                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 首次发布源码 | `8d5c9559fb4c96fa41777ec9a65d47e9e54dec40`                                                                                      |
| CI           | [通过](https://github.com/jasonBrom/ch592f-keydeck/actions/runs/39627148785)，包括网页、本地服务、固件主机/交叉测试与双版本编译 |
| Pages        | [部署成功](https://github.com/jasonBrom/ch592f-keydeck/actions/runs/39627637193)                                                |
| 发布方式     | GitHub Actions / `build_type=workflow`                                                                                          |
| HTTPS        | 已强制启用                                                                                                                      |
| 在线资源     | 首页、帮助、控制台脚本/样式与模型数据，共 39 个地址通过 HTTP 检查                                                               |
| 固件下载     | 两版 HEX/BIN，共 4 个文件的 SHA-256 与本地发布版本一致                                                                          |
| 浏览器页面   | 正确显示在线环境和 WebHID / Web Bluetooth 入口，初始页面无脚本错误                                                              |

详细资源与校验结果见 [online-check.json](online-check.json)。本次没有连接或写入真实键盘，设备侧功能仍遵循 [验证记录](VERIFICATION.md) 的范围。

![已上线的 KeyDeck 控制台，显示在线环境连接提示](images/console-online.png)

## 自动更新

后续推送 `main` 会触发 `.github/workflows/pages.yml`：检查网页与固件、从同一提交编译两版固件、生成下载文件、检查静态资源，再发布 `web/dist/`。`.github/workflows/ci.yml` 独立验证代码并上传固件构建产物。

首次工作流在 Pages 尚未启用时停在 `configure-pages`。现已通过 GitHub 官方 API 启用 Actions 发布与 HTTPS，重跑后部署成功，无需更换代码或降低检查要求。

在线版不运行 Python。Windows 已配对蓝牙管理仍需下载仓库、启动本地控制台；USB / 浏览器蓝牙配置在支持相应接口的桌面浏览器中使用。
