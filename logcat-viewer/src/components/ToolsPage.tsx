import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { AppInfo } from "../apps";
import type { DeviceInfo } from "../types";

interface Props {
  apps: AppInfo[];
  hasDevice: boolean;
  onOpenBackdoor: (pkg: string) => Promise<string>;
  onRestartApp: (pkg: string) => Promise<string>;
  onClearData: (pkg: string) => Promise<string>;
  onUninstall: (pkg: string) => Promise<string>;
  onScreenshot: () => Promise<string>;
  onInstallApk: () => Promise<string>;
  onDeviceInfo: () => Promise<DeviceInfo>;
  onBack: () => void;
}

export function ToolsPage(props: Props) {
  const [pkg, setPkg] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

  const appReady = props.hasDevice && !!pkg;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setStatus("");
    try {
      setStatus(await fn());
    } catch (e) {
      setStatus("失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  const showInfo = async () => {
    setBusy(true);
    setStatus("");
    try {
      setDeviceInfo(await props.onDeviceInfo());
    } catch (e) {
      setStatus("失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    if (!pkg) return;
    const ok = await ask(`确认清除「${pkg}」的全部数据？`, {
      title: "确认",
      kind: "warning",
    });
    if (!ok) return;
    await run(() => props.onClearData(pkg));
  };

  const doUninstall = async () => {
    if (!pkg) return;
    const ok = await ask(`确认卸载「${pkg}」？`, { title: "确认", kind: "warning" });
    if (!ok) return;
    await run(() => props.onUninstall(pkg));
  };

  return (
    <div className="manage-page">
      <div className="manage-header">
        <button onClick={props.onBack}>← 返回</button>
        <h1>应用工具</h1>
      </div>

      <section className="manage-section">
        <h2>应用操作</h2>
        <div className="manage-add">
          <label>应用</label>
          <select value={pkg} onChange={(e) => setPkg(e.target.value)}>
            <option value="">选择应用</option>
            {props.apps.map((a) => (
              <option key={a.package} value={a.package}>
                {a.name}（{a.package}）
              </option>
            ))}
          </select>
        </div>
        {!props.hasDevice && <p className="manage-desc">请先在日志页连接设备。</p>}
        <div className="tools-actions">
          <button
            disabled={!appReady || busy}
            onClick={() => run(() => props.onOpenBackdoor(pkg))}
          >
            打开后门
          </button>
          <button
            disabled={!appReady || busy}
            onClick={() => run(() => props.onRestartApp(pkg))}
          >
            重启应用
          </button>
          <button disabled={!appReady || busy} onClick={doClear}>
            清除数据
          </button>
          <button disabled={!appReady || busy} onClick={doUninstall}>
            卸载
          </button>
        </div>
      </section>

      <section className="manage-section">
        <h2>设备操作</h2>
        <div className="tools-actions">
          <button disabled={!props.hasDevice || busy} onClick={() => run(props.onScreenshot)}>
            截图
          </button>
          <button disabled={!props.hasDevice || busy} onClick={() => run(props.onInstallApk)}>
            安装 APK
          </button>
          <button disabled={!props.hasDevice || busy} onClick={showInfo}>
            设备信息
          </button>
        </div>
      </section>

      {status && <div className="tools-status">{status}</div>}
      {deviceInfo && (
        <dl className="device-info">
          <dt>型号</dt>
          <dd>
            {deviceInfo.brand} {deviceInfo.model}
          </dd>
          <dt>Android</dt>
          <dd>
            {deviceInfo.android}（SDK {deviceInfo.sdk}）
          </dd>
          <dt>序列号</dt>
          <dd>{deviceInfo.serial}</dd>
          <dt>CPU ABI</dt>
          <dd>{deviceInfo.abi}</dd>
          <dt>分辨率</dt>
          <dd>{deviceInfo.resolution}</dd>
          <dt>密度</dt>
          <dd>{deviceInfo.density}</dd>
          <dt>电量</dt>
          <dd>{deviceInfo.battery}</dd>
          <dt>存储</dt>
          <dd>{deviceInfo.storage}</dd>
        </dl>
      )}
    </div>
  );
}
