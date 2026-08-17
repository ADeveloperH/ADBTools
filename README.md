# ADBTools

Android 设备测试与调试工具集，目前包含两个工具：

## TestBench（测试工作台）—— 主项目

面向测试与开发的桌面工作台，覆盖日志查看、设备管理、常用调试工具、日志回归测试（规则引擎）、投屏录屏与性能监控。基于 Tauri 2 + React 构建，内置 adb/scrcpy（终端用户免安装），支持 Windows 与 macOS。

- 使用/开发/构建说明：[`testbench/README.md`](testbench/README.md)
- 安装说明（含未签名包放行步骤）：[`testbench/Docs/安装说明.md`](testbench/Docs/安装说明.md)
- 激励框架内置测试用例规划：[`testbench/Docs/内置测试用例规划.md`](testbench/Docs/内置测试用例规划.md)
- 跨平台构建：GitHub Actions（`.github/workflows/build.yml`），仓库 Actions 页手动触发

## adbtool —— 旧版 Python CLI 工具（历史版本）

独立交互式 ADB 命令行工具（Python），功能已基本被 TestBench 覆盖，保留用于兼容旧流程。它不需要放进任何游戏项目目录，也不要求游戏项目增加配置文件。

## 仓库约定

本仓库后续的文档、Codex 相关 skill、规范说明和提交信息统一使用中文。保留英文仅用于必须的技术标识、命令、字段名和文件名。

## 使用（adbtool）

1. 安装 Android SDK Platform-Tools，并确保 `adb` 在 `PATH` 中。
2. 用 USB 连接手机，打开开发者选项和 USB 调试，并在手机上确认授权。
3. 在本目录执行：

   ```bash
   ./adbtool
   ```

4. 先选择设备，再选择操作类型：
   - 通用/设备操作：安装 APK、查看 Activity/Task、截图、录屏、设备信息，不需要选择项目。
   - 项目操作：记录日志、按关键字过滤日志、打开应用后门、打开应用后门并保存日志、查询 Alarm、启动、重启、清除数据、卸载等，执行前再选择项目。

首次运行选择“添加并保存新项目”，输入项目名称、应用名称和包名。之后选择已有项目时，应用名称和包名会自动带入；APK 路径等不固定信息只在对应操作执行时输入。

项目配置保存在 `config/projects.json`，示例：

```json
{
  "projects": [
    {
      "id": "com_company_game",
      "project_name": "商店显示名称",
      "app_name": "应用名称",
      "package": "com.company.game",
      "store_name": "Google Play 商店名称",
      "company_name": "公司名称"
    }
  ]
}
```

其中 `project_name` 用于项目选择菜单，通常优先使用商店名称；`app_name` 和 `package` 分别保存应用名称和包名。`store_name`、`company_name` 用于保留项目资料，缺省时可以留空。

菜单配置保存在 `config/menu.json`。每个菜单项使用固定的 `id` 关联内部命令，你可以直接编辑 `label` 改名称、修改 `order` 调整顺序、设置 `enabled` 为 `false` 隐藏命令。例如：

```json
{
  "id": "restart_log",
  "label": "重启+抓日志",
  "order": 1,
  "enabled": true
}
```

如果菜单配置缺失、格式错误或漏掉某个命令，工具会自动使用该命令的默认名称和默认顺序。不要修改或删除 `id`，它用于关联程序内部的固定命令。

输出文件默认保存在：

```text
artifacts/
├── screenshots/                         # 通用截图
├── recordings/                          # 通用录屏
└── <项目 id>/
    └── logs/                            # 项目日志
```

`artifacts/` 中的运行产物已被 Git 忽略，不会提交到仓库。

## 菜单配置

通用/设备操作默认包括：

1. 安装 APK
2. 查看当前 Activity / Task
3. 截图
4. 录屏
5. 设备信息（型号、Android、分辨率、密度、电量、存储）

项目操作默认包括：

1. 重启应用并保存日志
2. 按关键字过滤查看日志
3. 保存当前应用日志
4. 打开应用后门
5. 打开应用后门并保存日志
6. 查看应用 Alarm
7. 启动应用
8. 重启应用
9. 清除应用数据
10. 卸载应用
11. 应用信息

编辑 `config/menu.json` 后，下次进入菜单时会读取最新配置，不需要修改 Python 代码。

## 常用操作

- 安装 APK：不需要选择项目，运行时输入 APK 的实际路径，执行覆盖安装。
- 查看当前 Activity / Task：执行 `dumpsys activity activities`，显示非 `null` 的 `TaskRecord` 和 `ActivityRecord`。
- 启动/重启应用：使用已保存的包名，通过 Android Launcher 启动。
- 重启应用并保存日志：先强停并启动当前应用，再按 PID 过滤 `logcat`，日志单独保存到 `artifacts/<项目 id>/logs/`，文件名自动带时间。
- 保存当前应用日志：不重启应用，直接保存当前运行实例的日志。
- 按关键字过滤查看日志：先输入一个或多个 tag/关键字，例如 `Unity, AndroidRuntime, Exception`，工具会按当前应用 PID 读取 `logcat`，命中任意关键字的日志会实时显示并保存到 `artifacts/<项目 id>/logs/`，文件名自动带 `_filtered`。
- 打开应用后门：使用当前项目包名和固定的 `com.foundation.unity.productdebugger.ProductSettingsActivity` 启动调试设置页面。
- 打开应用后门并保存日志：打开调试设置页面后，立即按当前应用 PID 保存 `logcat` 到 `artifacts/<项目 id>/logs/`；按 `Ctrl-C` 停止并保留已写入的日志。
- 查看应用 Alarm：查询设备上的 `dumpsys alarm`，只显示当前项目包名相关内容。
- 设备信息：显示序列号、制造商/品牌、型号、Android/SDK、CPU ABI、屏幕分辨率、屏幕密度、电量和 `/data` 分区存储。
- 截图/录屏：属于通用设备操作，默认按时间保存到 `artifacts/screenshots/` 和 `artifacts/recordings/`，也可临时修改保存路径。
- 清除数据/卸载：执行前要求确认。

如果同时连接多个设备，工具会先显示设备列表供选择，不会默认对错误设备执行操作。
