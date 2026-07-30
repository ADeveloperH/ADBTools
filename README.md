# ADBTools

一个独立的交互式 ADB 工具。它不需要放进任何游戏项目目录，也不要求游戏项目增加配置文件。

## 使用

1. 安装 Android SDK Platform-Tools，并确保 `adb` 在 `PATH` 中。
2. 用 USB 连接手机，打开开发者选项和 USB 调试，并在手机上确认授权。
3. 在本目录执行：

   ```bash
   ./adbtool
   ```

4. 先选择设备，再选择操作类型：
   - 通用/设备操作：安装 APK、查看 Activity/Task、截图、录屏、设备信息，不需要选择项目。
   - 项目操作：记录日志、打开应用后门、查询 Alarm、启动、重启、清除数据、卸载等，执行前再选择项目。

首次运行选择“添加并保存新项目”，输入项目名称、应用名称和包名。之后选择已有项目时，应用名称和包名会自动带入；APK 路径等不固定信息只在对应操作执行时输入。

项目配置保存在 `config/projects.json`，示例：

```json
{
  "projects": [
    {
      "id": "com_company_game",
      "project_name": "游戏 A",
      "app_name": "游戏 A",
      "package": "com.company.game"
    }
  ]
}
```

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
2. 保存当前应用日志
3. 打开应用后门
4. 查看应用 Alarm
5. 启动应用
6. 重启应用
7. 清除应用数据
8. 卸载应用
9. 应用信息

编辑 `config/menu.json` 后，下次进入菜单时会读取最新配置，不需要修改 Python 代码。

## 常用操作

- 安装 APK：不需要选择项目，运行时输入 APK 的实际路径，执行覆盖安装。
- 查看当前 Activity / Task：执行 `dumpsys activity activities`，显示非 `null` 的 `TaskRecord` 和 `ActivityRecord`。
- 启动/重启应用：使用已保存的包名，通过 Android Launcher 启动。
- 重启应用并保存日志：先强停并启动当前应用，再按 PID 过滤 `logcat`，日志单独保存到 `artifacts/<项目 id>/logs/`，文件名自动带时间。
- 保存当前应用日志：不重启应用，直接保存当前运行实例的日志。
- 打开应用后门：使用当前项目包名和固定的 `com.foundation.unity.productdebugger.ProductSettingsActivity` 启动调试设置页面。
- 查看应用 Alarm：查询设备上的 `dumpsys alarm`，只显示当前项目包名相关内容。
- 设备信息：显示序列号、制造商/品牌、型号、Android/SDK、CPU ABI、屏幕分辨率、屏幕密度、电量和 `/data` 分区存储。
- 截图/录屏：属于通用设备操作，默认按时间保存到 `artifacts/screenshots/` 和 `artifacts/recordings/`，也可临时修改保存路径。
- 清除数据/卸载：执行前要求确认。

如果同时连接多个设备，工具会先显示设备列表供选择，不会默认对错误设备执行操作。
