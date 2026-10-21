# KeyDeck 控制台

无框架的静态 HTML / CSS / ES Modules，设备协议、编辑器与模型资源均位于 `public/`，不依赖 CDN。Node 22+ 用于测试和静态打包；运行设备控制台本身不需要 Node。

```sh
python start-console.py            # 本地设备控制台，默认 localhost:8792
npm test                          # 浏览器逻辑与配置协议测试
npm run build                     # 输出 dist/，并检查资源与相对路径
```

Windows 可以双击 `StartConsole.cmd`；需要配对蓝牙管理时安装 `requirements-windows.txt`，启动器可安装到本目录 `.runtime/`。不要通过 `file://` 直接打开 HTML。

| 运行方式 | USB | 浏览器蓝牙 | Windows 已配对蓝牙 |
| --- | --- | --- | --- |
| GitHub Pages / HTTPS | WebHID | Web Bluetooth | 不提供本地桥接 |
| Python 本地控制台 | WebHID | Web Bluetooth | Bleak / WinRT，可用时自动识别 |
| 普通静态 localhost | WebHID | Web Bluetooth | 不可用 |

以上接口还取决于浏览器、系统与权限。首次选设备需点击授权；在线页与本地页的权限分别管理。在线页不探测本机蓝牙服务；没有跨站代理或云端设备数据存储。

## 主要代码

- `public/index.html`：页面结构和控件。
- `public/config/console-light.css`：浅色界面与响应式布局；原组件布局样式保留供编辑器使用。
- `public/config/console.js`：草稿、改键、宏和统一试用/保存流程。
- `public/config/console-experience.js`：视图切换、固件版本提示与键盘导航。
- `public/config/schema.js`：1024 字节配置编解码、校验和协议帧。
- `public/config/transport.js`：USB/BLE 传输、分包、事务、回读。
- `public/config/connection.js`：已授权设备发现与连接优先级。
- `public/config/windows-bluetooth.js`：同源本地服务客户端。
- `public/config/*-editor.js`：触觉、配置层、状态灯等独立编辑器。
- `public/assembly.html`、`app.js`：可选三维装配视图。主界面默认使用可点选按键视图，3D 资源按需加载。
- `start-console.py`、`windows_ble.py`：本地服务。保留 loopback 监听、Host / Origin 检查、会话令牌与命令白名单。

## 使用顺序

1. 连接设备并读取配置。若已有未保存草稿，连接不会覆盖草稿。
2. 点击左侧按键或编号，选择动作；切换编辑层不会切换设备运行层。
3. 点击「试用」临时应用，或「保存到设备」写入 Flash 并完整回读。
4. 无震动版自动禁用触觉页，其他配置仍能读写；导入的触觉预留字段保留。

页面不会自动烧录固件，也不会在打开时自动写入设备。切换固件版本请先导出配置。
