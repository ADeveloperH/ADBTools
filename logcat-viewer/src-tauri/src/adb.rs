//! ADB 相关操作封装：设备枚举、logcat 子进程、配对/连接等。

use serde::Serialize;
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};

/// 一台连接的设备（USB 或 WiFi）。
#[derive(Debug, Clone, Serialize)]
pub struct Device {
    pub serial: String,
    pub state: String,
    pub model: String,
    pub product: String,
    /// "usb" 或 "wifi"
    pub transport: String,
}

/// 执行 `adb devices -l` 并解析结果。
pub fn list_devices() -> Result<Vec<Device>, String> {
    log::debug!("执行 adb devices -l");
    let output = Command::new("adb")
        .args(["devices", "-l"])
        .output()
        .map_err(|e| format!("无法执行 adb，请确认已安装 Android Platform-Tools：{e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    log::debug!("adb devices -l 原始输出：\n{stdout}");

    if !output.status.success() {
        log::error!("adb devices 执行失败：{stderr}");
        return Err(if stderr.trim().is_empty() {
            "adb devices 执行失败".to_string()
        } else {
            stderr.trim().to_string()
        });
    }

    let mut devices = Vec::new();
    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut fields = line.split_whitespace();
        let serial = fields.next().unwrap_or("").to_string();
        let state = fields.next().unwrap_or("").to_string();
        let mut model = String::new();
        let mut product = String::new();
        let mut is_usb = false;
        for f in fields {
            if let Some(v) = f.strip_prefix("model:") {
                model = v.to_string();
            } else if let Some(v) = f.strip_prefix("product:") {
                product = v.to_string();
            } else if f.starts_with("usb:") {
                is_usb = true;
            }
        }
        let transport = if is_usb { "usb" } else { "wifi" };
        log::debug!("设备行：serial={serial} state={state} transport={transport}");
        devices.push(Device {
            serial,
            state,
            model,
            product,
            transport: transport.to_string(),
        });
    }
    log::info!("枚举到 {} 台设备", devices.len());
    Ok(devices)
}

/// 执行一个 adb 命令并捕获输出（用于 pair / connect / disconnect 等短命令）。
fn run_adb_capture(args: &[&str]) -> Result<String, String> {
    log::debug!("执行 adb {}", args.join(" "));
    let output = Command::new("adb")
        .args(args)
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        let out = if stdout.is_empty() { &stderr } else { &stdout };
        log::debug!("adb 命令成功，输出：{out}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!(
            "adb 命令失败（exit {:?}）：stdout={stdout} stderr={stderr}",
            output.status.code()
        );
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// 清除指定设备的 logcat 缓冲区。
pub fn clear_log(device: Option<&str>) -> Result<(), String> {
    log::info!("清空 logcat 缓冲区，设备：{:?}", device);
    let mut cmd = Command::new("adb");
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["logcat", "-c"])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    if output.status.success() {
        log::debug!("adb logcat -c 成功");
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::error!("adb logcat -c 失败：{err}");
        Err(err)
    }
}

/// WiFi 配对（Android 11+ 无线调试）。
pub fn pair(ip: &str, port: &str, code: &str) -> Result<String, String> {
    let target = format!("{ip}:{port}");
    log::info!("开始 WiFi 配对：{target}");
    run_adb_capture(&["pair", target.as_str(), code])
}

/// WiFi 连接。
pub fn connect(ip: &str, port: &str) -> Result<String, String> {
    let target = format!("{ip}:{port}");
    log::info!("开始 WiFi 连接：{target}");
    run_adb_capture(&["connect", target.as_str()])
}

/// 断开网络设备。
pub fn disconnect(target: &str) -> Result<String, String> {
    log::info!("断开设备：{target}");
    run_adb_capture(&["disconnect", target])
}

/// 一个运行中的 `adb logcat` 子进程。
pub struct LogcatProcess {
    child: Child,
}

impl LogcatProcess {
    /// 启动 `adb [-s <device>] logcat -v threadtime [-b <buffer>]`。
    pub fn start(device: Option<&str>, buffer: Option<&str>) -> Result<Self, String> {
        let mut cmd = Command::new("adb");
        if let Some(d) = device {
            cmd.arg("-s").arg(d);
        }
        cmd.args(["logcat", "-v", "threadtime"]);
        if let Some(b) = buffer {
            cmd.arg("-b").arg(b);
        }
        log::info!("启动 logcat：device={:?} buffer={:?}", device, buffer);
        log::debug!("完整命令：{:?}", cmd);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let child = cmd.spawn().map_err(|e| format!("无法启动 logcat：{e}"))?;
        log::info!("logcat 子进程已启动，pid={}", child.id());
        Ok(Self { child })
    }

    /// 取出 stdout，供独立线程按行读取。
    pub fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.stdout.take()
    }

    /// 取出 stderr，供独立线程读取错误信息。
    pub fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.stderr.take()
    }

    /// 结束进程并回收。
    pub fn stop(&mut self) {
        log::info!("停止 logcat 子进程，pid={}", self.child.id());
        let _ = self.child.kill();
        let _ = self.child.wait();
        log::debug!("logcat 子进程已停止");
    }
}

/// WiFi 二维码配对所需信息。
#[derive(Debug, Clone, Serialize)]
pub struct PairingInfo {
    pub service_name: String,
    pub code: String,
    /// 二维码内容：WIFI:T:ADB;S:<service_name>;P:<code>;;
    pub payload: String,
}

/// 生成一次二维码配对的随机服务名与 6 位配对码。
pub fn generate_pairing() -> PairingInfo {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let seed = (now.as_nanos() as u64) ^ ((std::process::id() as u64) << 32);
    let code = format!("{}", 100000 + (seed % 900000));
    let service_name = format!("adbqr-{:08x}", (seed >> 16) as u32);
    let payload = format!("WIFI:T:ADB;S:{service_name};P:{code};;");
    log::debug!("生成二维码配对信息：service_name={service_name} code={code}");
    PairingInfo {
        service_name,
        code,
        payload,
    }
}

/// 通过 mDNS 查找正在等待配对的设备地址（ip:port），找不到返回 None。
pub fn mdns_pairing_address() -> Result<Option<String>, String> {
    let output = Command::new("adb")
        .args(["mdns", "services"])
        .output()
        .map_err(|e| format!("无法执行 adb mdns services：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    log::debug!("adb mdns services 输出：\n{stdout}");
    for line in stdout.lines() {
        if line.contains("_adb-tls-pairing._tcp") {
            // 格式：<实例名>  _adb-tls-pairing._tcp  <ip:port>
            let addr = line.split_whitespace().nth(2).map(|s| s.to_string());
            log::info!("mDNS 发现待配对设备：{:?}", addr);
            return Ok(addr);
        }
    }
    log::debug!("mDNS 尚未发现待配对设备");
    Ok(None)
}

/// 解析指定包名当前运行的 PID 列表（`adb shell pidof`）。
pub fn resolve_pids(device: Option<&str>, package: &str) -> Result<Vec<String>, String> {
    log::info!("解析包名 PID：device={:?} package={package}", device);
    let mut cmd = Command::new("adb");
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["shell", "pidof", package])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    log::debug!("adb shell pidof 原始输出：{stdout}");
    if stdout.is_empty() {
        log::warn!("包 {package} 当前无运行进程");
        return Ok(Vec::new());
    }
    let pids: Vec<String> = stdout
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    log::info!("包 {package} 的 PID：{pids:?}");
    Ok(pids)
}

/// 一个配置中的应用（用于「应用过滤」下拉框）。
#[derive(Debug, Clone, Serialize)]
pub struct App {
    pub name: String,
    pub package: String,
}

/// 从远程 URL 拉取并解析应用清单（支持 `{ projects: [...] }` 或 `{ apps: [...] }`）。
pub fn fetch_remote_apps(url: &str) -> Result<Vec<App>, String> {
    log::info!("拉取远程应用清单：{url}");
    let body = ureq::get(url)
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("请求失败：{e}"))?
        .into_string()
        .map_err(|e| format!("读取响应失败：{e}"))?;

    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("JSON 解析失败：{e}"))?;
    let list = value
        .get("projects")
        .or_else(|| value.get("apps"))
        .and_then(|v| v.as_array())
        .ok_or("配置中缺少 projects/apps 数组")?;

    let mut apps = Vec::new();
    for item in list {
        let Some(pkg) = item.get("package").and_then(|v| v.as_str()) else {
            continue;
        };
        if pkg.is_empty() {
            continue;
        }
        let name = item
            .get("app_name")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("project_name").and_then(|v| v.as_str()))
            .or_else(|| item.get("name").and_then(|v| v.as_str()))
            .unwrap_or(pkg);
        apps.push(App {
            name: name.to_string(),
            package: pkg.to_string(),
        });
    }
    log::info!("远程清单解析出 {} 个应用", apps.len());
    Ok(apps)
}

/// 打开应用后门（调试 Activity）。
pub fn open_backdoor(
    device: Option<&str>,
    package: &str,
    activity: &str,
) -> Result<String, String> {
    let component = format!("{package}/{activity}");
    log::info!("打开后门：device={:?} component={component}", device);
    let mut cmd = Command::new("adb");
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["shell", "am", "start", "-n", &component])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        log::info!("后门已打开：{component}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!("打开后门失败：{stderr}");
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// 重启应用：force-stop 后通过 Launcher 启动。
pub fn restart_app(device: Option<&str>, package: &str) -> Result<(), String> {
    log::info!("重启应用：device={:?} package={package}", device);
    let mut stop = Command::new("adb");
    if let Some(d) = device {
        stop.arg("-s").arg(d);
    }
    let out = stop
        .args(["shell", "am", "force-stop", package])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }

    let mut launch = Command::new("adb");
    if let Some(d) = device {
        launch.arg("-s").arg(d);
    }
    let out = launch
        .args([
            "shell",
            "monkey",
            "-p",
            package,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    log::info!("应用已重启：{package}");
    Ok(())
}

/// 截图，返回 PNG 原始字节（`adb exec-out screencap -p`）。
pub fn screencap_png(device: Option<&str>) -> Result<Vec<u8>, String> {
    log::info!("截图：device={:?}", device);
    let mut cmd = Command::new("adb");
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["exec-out", "screencap", "-p"])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::error!("截图失败：{err}");
        return Err(if err.is_empty() { "截图失败".to_string() } else { err });
    }
    Ok(output.stdout)
}

/// 覆盖安装 APK。
pub fn install_apk(device: Option<&str>, path: &str) -> Result<String, String> {
    log::info!("安装 APK：device={:?} path={path}", device);
    let mut cmd = Command::new("adb");
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["install", "-r", path])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        log::info!("APK 安装成功：{path}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!("APK 安装失败：{stderr}");
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// 清除应用数据。
pub fn clear_app_data(device: Option<&str>, package: &str) -> Result<String, String> {
    log::info!("清除应用数据：device={:?} package={package}", device);
    let mut cmd = Command::new("adb");
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["shell", "pm", "clear", package])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        log::info!("清除数据成功：{package}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!("清除数据失败：{stderr}");
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// 卸载应用。
pub fn uninstall_app(device: Option<&str>, package: &str) -> Result<String, String> {
    log::info!("卸载应用：device={:?} package={package}", device);
    let mut cmd = Command::new("adb");
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(["uninstall", package])
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        log::info!("卸载成功：{package}");
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        log::error!("卸载失败：{stderr}");
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// 设备信息。
#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    pub serial: String,
    pub brand: String,
    pub model: String,
    pub android: String,
    pub sdk: String,
    pub abi: String,
    pub resolution: String,
    pub density: String,
    pub battery: String,
    pub storage: String,
}

fn adb_shell_output(device: Option<&str>, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("adb");
    if let Some(d) = device {
        cmd.arg("-s").arg(d);
    }
    let output = cmd
        .args(args)
        .output()
        .map_err(|e| format!("无法执行 adb：{e}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn getprop(device: Option<&str>, key: &str) -> Result<String, String> {
    adb_shell_output(device, &["shell", "getprop", key])
}

pub fn device_info(device: Option<&str>) -> Result<DeviceInfo, String> {
    log::info!("获取设备信息：device={:?}", device);
    let serial = match device {
        Some(d) => d.to_string(),
        None => adb_shell_output(None, &["get-serialno"])?,
    };
    let brand = getprop(device, "ro.product.brand")?;
    let model = getprop(device, "ro.product.model")?;
    let android = getprop(device, "ro.build.version.release")?;
    let sdk = getprop(device, "ro.build.version.sdk")?;
    let abi = getprop(device, "ro.product.cpu.abi")?;
    let resolution = adb_shell_output(device, &["shell", "wm", "size"])?;
    let density = adb_shell_output(device, &["shell", "wm", "density"])?;
    let battery = adb_shell_output(device, &["shell", "dumpsys", "battery"])?
        .lines()
        .find(|l| l.contains("level:"))
        .unwrap_or("")
        .trim()
        .to_string();
    let storage = adb_shell_output(device, &["shell", "df", "/data"])?
        .lines()
        .last()
        .unwrap_or("")
        .to_string();
    Ok(DeviceInfo {
        serial,
        brand,
        model,
        android,
        sdk,
        abi,
        resolution,
        density,
        battery,
        storage,
    })
}
