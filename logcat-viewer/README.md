# logcat-viewer

复刻 Android Studio Logcat 的桌面日志查看工具，面向 Windows 与 macOS 用户。基于 Tauri 2 构建，后端用 Rust 调用本机 `adb`，前端用 React + TypeScript 渲染日志列表。

## 技术栈

- **框架**：Tauri 2（体积小、内存低，适合长时间挂着刷日志）
- **后端**：Rust —— 枚举设备、启动 `adb logcat` 子进程、流式读取 stdout、通过事件推给前端
- **前端**：React 19 + TypeScript + Vite，虚拟滚动用 `@tanstack/react-virtual`
- **依赖**：本机需安装 Android Platform-Tools（`adb` 在 `PATH` 中）

## 已实现功能

- 设备枚举（USB 与 WiFi，`adb devices -l`），手动刷新，多设备下拉选择
- 选中设备自动开始抓取 `adb logcat -v threadtime`
- 实时流式日志，批量刷新 + 环形缓冲（上限 20 万行，超出丢最旧）
- 按级别过滤（Verbose/Debug/Info/Warn/Error/Fatal/Assert，取最低级别）
- 关键字搜索（子串或正则，匹配消息或 Tag）
- Tag 过滤（逗号分隔，多值命中任一）
- 应用下拉选择过滤（只显示配置中的应用，选中后按包名解析 PID 过滤，支持远程更新清单）
- 按级别着色、多行消息续行合并
- 暂停/继续、自动滚动、清空（本地缓冲 + 设备 logcat 缓冲区）、导出（系统保存对话框）
- 缓冲区选择（main/system/crash/radio/events/all）
- WiFi 配对（配对码 + 二维码）与连接

## 计划中的功能

- [ ] 已保存过滤器（类似 AS 的 filter configuration）
- [ ] 日志分页与跳转、点击展开单行
- [ ] 打包自带 adb 二进制（终端用户免装 Platform-Tools）
- [ ] macOS 签名/公证、Windows 签名（分发必需）

## 架构

```
前端（React）
  ├─ useLogcat  hook：状态管理、事件订阅、批量刷新、过滤
  ├─ LogList    虚拟滚动列表（只渲染可视区）
  └─ App        工具栏（设备/缓冲区/级别/搜索/过滤/操作）
        │ invoke() 调用命令 / listen() 订阅事件
后端（Rust）
  ├─ adb.rs     adb 封装：设备枚举、logcat 子进程、配对/连接、清空
  └─ lib.rs     命令定义 + 全局状态 + 事件发射
```

后端通过 `logcat-line` 事件把每一行原文推给前端，前端解析成结构化字段后统一过滤，因此切换过滤条件无需重启 `logcat` 进程。

## 目录结构

```
logcat-viewer/
├── src/                  # 前端源码
│   ├── App.tsx           # 主界面
│   ├── App.css           # 样式（深色主题）
│   ├── parse.ts          # threadtime 行解析
│   ├── types.ts          # 类型与常量
│   ├── hooks/useLogcat.ts
│   └── components/LogList.tsx
├── src-tauri/            # Rust 后端
│   ├── src/{main,lib,adb}.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

## 开发

前置：Rust 工具链、Node.js + pnpm、Android Platform-Tools。

```bash
pnpm install
pnpm tauri dev
```

## 构建与打包

```bash
pnpm tauri build
```

产物按当前操作系统生成（macOS 出 `.app`/`.dmg`，Windows 出 `.exe`/`.msi`）。跨平台产物建议用 CI（GitHub Actions）分别跑 macOS 与 Windows runner。

## 日志与调试

调试阶段开启详细日志（Debug 级别），同时输出到终端和日志文件：

- **终端**：`pnpm tauri dev` 运行时会实时打印。
- **日志文件**：
  - macOS：`~/Library/Logs/com.adbtools.logcatviewer/logcat-viewer.log`
  - Windows：`%LOCALAPPDATA%\com.adbtools.logcatviewer\logs\logcat-viewer.log`

遇到问题时，把日志文件内容（或终端输出）发出来即可定位。正式发布前可把日志级别调低（`lib.rs` 里 `.level(log::LevelFilter::Debug)` 改为 `Info`）并移除不必要的日志。

## 应用清单（远程更新）

「应用」下拉框的清单采用三级兜底：远程 → 本地缓存 → 内置默认。

- 远程地址：`https://raw.githubusercontent.com/ADeveloperH/ADBTools/main/config/projects.json`
- 新增应用只需修改该文件并 push，用户下次启动自动更新，无需重新打包/安装；
- 离线时使用上次拉取的本地缓存；首次安装即离线则用内置的默认应用清单。

## WiFi 配对二维码（笔记）

Android 11+ 无线调试的二维码内容是：

```text
WIFI:T:ADB;S:<mDNS 服务名>;P:<配对口令>;;
```

`WIFI:` 前缀只是借用格式，`S` 是 mDNS 服务名而非 SSID，`P` 是配对码。配对依赖 mDNS 发现设备，因此公共/访客 WiFi（客户端隔离）会配对失败，此时建议改用配对码方式或手机热点。
