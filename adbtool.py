#!/usr/bin/env python3
"""Interactive ADB helper for managing multiple game projects."""

from __future__ import annotations

import json
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config" / "projects.json"
MENU_CONFIG_PATH = ROOT / "config" / "menu.json"
ARTIFACTS_PATH = ROOT / "artifacts"
PRODUCT_SETTINGS_ACTIVITY = "com.foundation.unity.productdebugger.ProductSettingsActivity"

DEFAULT_MENU = {
    "global": [
        {"id": "install_apk", "label": "安装 APK", "order": 10, "enabled": True},
        {"id": "show_activity", "label": "查看当前 Activity / Task", "order": 20, "enabled": True},
        {"id": "screenshot", "label": "截图", "order": 30, "enabled": True},
        {"id": "record", "label": "录屏", "order": 40, "enabled": True},
        {"id": "device_info", "label": "设备信息", "order": 50, "enabled": True},
    ],
    "project": [
        {"id": "restart_log", "label": "重启应用并保存日志", "order": 10, "enabled": True},
        {"id": "save_log", "label": "保存当前应用日志", "order": 20, "enabled": True},
        {"id": "product_settings", "label": "打开 Product Settings", "order": 30, "enabled": True},
        {"id": "alarm", "label": "查看应用 Alarm", "order": 40, "enabled": True},
        {"id": "launch", "label": "启动应用", "order": 50, "enabled": True},
        {"id": "restart", "label": "重启应用", "order": 60, "enabled": True},
        {"id": "clear", "label": "清除应用数据", "order": 70, "enabled": True},
        {"id": "uninstall", "label": "卸载应用", "order": 80, "enabled": True},
        {"id": "app_info", "label": "应用信息", "order": 90, "enabled": True},
    ],
}


def load_menu(scope: str) -> list[dict]:
    """Load user labels/order while keeping the built-in command set stable."""
    configured = {}
    try:
        data = json.loads(MENU_CONFIG_PATH.read_text(encoding="utf-8"))
        items = data.get(scope, [])
        if isinstance(items, list):
            configured = {
                item["id"]: item
                for item in items
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            }
    except (OSError, json.JSONDecodeError, TypeError, AttributeError):
        pass
    entries = []
    for default in DEFAULT_MENU[scope]:
        item = {**default, **configured.get(default["id"], {})}
        try:
            item["order"] = int(item.get("order", default["order"]))
        except (TypeError, ValueError):
            item["order"] = default["order"]
        if not isinstance(item.get("label"), str) or not item["label"].strip():
            item["label"] = default["label"]
        if not isinstance(item.get("enabled"), bool):
            item["enabled"] = default["enabled"]
        entries.append(item)
    return sorted((item for item in entries if item["enabled"]), key=lambda item: item["order"])


@dataclass
class Project:
    id: str
    project_name: str
    app_name: str
    package: str


def load_projects() -> list[Project]:
    if not CONFIG_PATH.exists():
        return []
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"无法读取配置 {CONFIG_PATH}: {exc}")
        return []
    return [Project(**item) for item in data.get("projects", [])]


def save_projects(projects: list[Project]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"projects": [project.__dict__ for project in projects]}
    CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ask(prompt: str, default: Optional[str] = None) -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or (default or "")


def choose(title: str, options: list[str], allow_back: bool = True) -> Optional[int]:
    print(f"\n{title}")
    for index, option in enumerate(options, 1):
        print(f"  {index}. {option}")
    if allow_back:
        print("  0. 返回")
    while True:
        value = input("> ").strip()
        if allow_back and value == "0":
            return None
        if value.isdigit() and 1 <= int(value) <= len(options):
            return int(value) - 1
        print("请输入有效编号。")


def adb_path() -> str:
    path = shutil.which("adb")
    if not path:
        print("未找到 adb。请先安装 Android platform-tools，并确保 adb 在 PATH 中。")
        raise SystemExit(1)
    return path


def run_adb(
    args: list[str],
    device: Optional[str] = None,
    capture: bool = False,
    text: bool = True,
) -> subprocess.CompletedProcess:
    command = [adb_path()]
    if device:
        command += ["-s", device]
    command += args
    print(f"\n$ {shlex.join(command)}")
    return subprocess.run(command, text=text, capture_output=capture)


def devices() -> list[tuple[str, str]]:
    result = run_adb(["devices", "-l"], capture=True)
    if result.returncode != 0:
        print(result.stderr.strip())
        return []
    found = []
    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            label = next((p.split(":", 1)[1] for p in parts[2:] if p.startswith("model:")), parts[0])
            found.append((parts[0], label.replace("_", " ")))
    return found


def choose_device() -> Optional[str]:
    found = devices()
    if not found:
        print("没有检测到已授权的 Android 设备。请连接手机并确认 USB 调试授权。")
        return None
    index = choose("选择设备", [f"{label} ({serial})" for serial, label in found])
    return found[index][0] if index is not None else None


def select_project() -> Optional[Project]:
    projects = load_projects()
    options = [f"{p.project_name} - {p.app_name} ({p.package})" for p in projects]
    options += ["临时项目（本次使用，不保存）", "添加并保存新项目"]
    index = choose("选择项目", options)
    if index is None:
        return None
    if index < len(projects):
        return projects[index]
    if index == len(projects):
        return make_project("临时项目", save=False)
    return make_project("新项目", save=True)


def make_project(default_name: str, save: bool) -> Project:
    project_name = ask("项目名称", default_name)
    app_name = ask("应用名称")
    package = ask("包名")
    if not app_name or not package:
        raise ValueError("应用名称和包名不能为空。")
    project_id = package.replace(".", "_")
    project = Project(project_id, project_name, app_name, package)
    if save:
        projects = load_projects()
        projects = [p for p in projects if p.id != project.id]
        projects.append(project)
        save_projects(projects)
        print(f"已保存项目：{project.project_name}")
    return project


def artifact_dir(project: Project, kind: str) -> Path:
    path = ARTIFACTS_PATH / project.id / kind
    path.mkdir(parents=True, exist_ok=True)
    return path


def confirm(message: str) -> bool:
    return ask(f"{message} [y/N]").lower() in {"y", "yes"}


def action_install(device: str) -> None:
    apk = Path(ask("APK 文件路径")).expanduser()
    if not apk.is_file():
        print(f"文件不存在：{apk}")
        return
    run_adb(["install", "-r", str(apk)], device)


def action_launch(project: Project, device: str, restart: bool = False) -> None:
    if restart:
        run_adb(["shell", "am", "force-stop", project.package], device)
    run_adb(["shell", "monkey", "-p", project.package, "-c", "android.intent.category.LAUNCHER", "1"], device)


def log_path(project: Project) -> Path:
    path = ARTIFACTS_PATH / project.id / "logs" / f"{datetime.now():%Y%m%d_%H%M%S}.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def action_log(project: Project, device: str, restart: bool = False) -> None:
    if restart:
        run_adb(["shell", "am", "force-stop", project.package], device)
        run_adb(["shell", "monkey", "-p", project.package, "-c", "android.intent.category.LAUNCHER", "1"], device)
    # Resolve the PID after launch so the log only contains this app's output.
    pid = _pid(project.package, device)
    if pid == "0":
        print(f"未找到运行中的应用：{project.package}")
        return
    output = log_path(project)
    print(f"日志保存到：{output}")
    print("按 Ctrl-C 停止日志。日志只保存到文件，不在终端重复输出。")
    command = ["logcat", "--pid", pid, "-v", "threadtime"]
    adb = adb_path()
    full_command = [adb, "-s", device, *command]
    with output.open("w", encoding="utf-8") as stream:
        print(f"\n$ {shlex.join(full_command)} > {shlex.quote(str(output))}")
        try:
            subprocess.run(full_command, stdout=stream, stderr=subprocess.STDOUT, text=True)
        except KeyboardInterrupt:
            print("\n日志已停止并保存。")


def _pid(package: str, device: str) -> str:
    result = run_adb(["shell", "pidof", package], device, capture=True)
    pid = result.stdout.strip().split()[0] if result.stdout.strip() else "0"
    return pid


def action_screenshot(device: str) -> None:
    default = ARTIFACTS_PATH / "screenshots" / f"{datetime.now():%Y%m%d_%H%M%S}.png"
    output = Path(ask("截图保存路径", str(default))).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    result = run_adb(["exec-out", "screencap", "-p"], device, capture=True, text=False)
    if result.returncode == 0:
        output.write_bytes(result.stdout)
        print(f"截图已保存：{output}")
    else:
        print(result.stderr.strip())


def action_record(device: str) -> None:
    default = ARTIFACTS_PATH / "recordings" / f"{datetime.now():%Y%m%d_%H%M%S}.mp4"
    output = Path(ask("录屏保存路径", str(default))).expanduser()
    seconds = ask("录屏时长（秒）", "30")
    remote = "/sdcard/adbtool-record.mp4"
    run_adb(["shell", "screenrecord", "--time-limit", seconds, remote], device)
    run_adb(["pull", remote, str(output)], device)
    run_adb(["shell", "rm", remote], device)


def action_clear(project: Project, device: str) -> None:
    if confirm(f"确认清除 {project.app_name} 的全部数据？"):
        run_adb(["shell", "pm", "clear", project.package], device)


def action_uninstall(project: Project, device: str) -> None:
    if confirm(f"确认卸载 {project.app_name}？"):
        run_adb(["uninstall", project.package], device)


def action_device_info(device: str) -> None:
    run_adb(["shell", "getprop", "ro.product.model"], device)


def action_activity(device: str) -> None:
    result = run_adb(["shell", "dumpsys", "activity", "activities"], device, capture=True)
    if result.returncode == 0:
        lines = [line for line in result.stdout.splitlines() if "TaskRecord" in line or "ActivityRecord" in line]
        lines = [line for line in lines if "null" not in line]
        print("\n".join(lines) if lines else "未找到 ActivityRecord 或 TaskRecord。")
    else:
        print(result.stderr.strip())


def action_product_settings(project: Project, device: str) -> None:
    component = f"{project.package}/{PRODUCT_SETTINGS_ACTIVITY}"
    run_adb(["shell", "am", "start", "-n", component], device)


def action_alarm(project: Project, device: str) -> None:
    result = run_adb(["shell", "dumpsys", "alarm"], device, capture=True)
    if result.returncode == 0:
        lines = [line for line in result.stdout.splitlines() if project.package in line]
        print("\n".join(lines) if lines else f"Alarm 中未找到：{project.package}")
    else:
        print(result.stderr.strip())


def global_menu(device: str) -> None:
    handlers = {
        "install_apk": action_install,
        "show_activity": action_activity,
        "screenshot": action_screenshot,
        "record": action_record,
        "device_info": action_device_info,
    }
    while True:
        commands = load_menu("global")
        index = choose(
            f"设备：{device}\n选择通用操作（不需要选择项目）",
            [command["label"] for command in commands],
        )
        if index is None:
            return
        try:
            handlers[commands[index]["id"]](device)
        except (KeyboardInterrupt, EOFError):
            print("\n操作已取消。")
        except ValueError as exc:
            print(f"输入错误：{exc}")


def project_menu(project: Project, device: str) -> None:
    handlers = {
        "restart_log": lambda p, d: action_log(p, d, restart=True),
        "save_log": action_log,
        "product_settings": action_product_settings,
        "alarm": action_alarm,
        "launch": lambda p, d: action_launch(p, d),
        "restart": lambda p, d: action_launch(p, d, restart=True),
        "clear": action_clear,
        "uninstall": action_uninstall,
        "app_info": lambda p, d: run_adb(["shell", "dumpsys", "meminfo", p.package], d),
    }
    while True:
        commands = load_menu("project")
        index = choose(
            f"{project.project_name} | {project.app_name} | {device}\n选择操作",
            [command["label"] for command in commands],
        )
        if index is None:
            return
        try:
            handlers[commands[index]["id"]](project, device)
        except (KeyboardInterrupt, EOFError):
            print("\n操作已取消。")
        except ValueError as exc:
            print(f"输入错误：{exc}")


def main() -> None:
    print("ADBTools - 多项目 Android 调试工具")
    while True:
        try:
            device = choose_device()
            if not device:
                return
            while True:
                index = choose(
                    f"当前设备：{device}\n选择操作类型",
                    ["通用/设备操作（无需选择项目）", "项目操作（需要先选择项目）", "切换设备", "退出"],
                )
                if index is None or index == 3:
                    print("再见。")
                    return
                if index == 0:
                    global_menu(device)
                elif index == 1:
                    project = select_project()
                    if project:
                        project_menu(project, device)
                elif index == 2:
                    break
        except (KeyboardInterrupt, EOFError):
            print("\n再见。")
            return
        except ValueError as exc:
            print(f"输入错误：{exc}")


if __name__ == "__main__":
    main()
