import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useLogcat } from "./hooks/useLogcat";
import { usePrefs } from "./hooks/usePrefs";
import { HistoryInput } from "./components/HistoryInput";
import { LogList } from "./components/LogList";
import { ManagePage } from "./components/ManagePage";
import { ToolsPage } from "./components/ToolsPage";
import { WifiPanel } from "./components/WifiPanel";
import { BUILTIN_APPS, DEFAULT_BACKDOOR, loadApps } from "./apps";
import type { AppInfo } from "./apps";
import { BUFFERS, LEVELS } from "./types";
import type { DeviceInfo, LogLevel } from "./types";
import "./App.css";

const LEVEL_LABELS: Record<LogLevel, string> = {
  V: "Verbose",
  D: "Debug",
  I: "Info",
  W: "Warn",
  E: "Error",
  F: "Fatal",
  A: "Assert",
};

export default function App() {
  const {
    devices,
    selectedDevice,
    setSelectedDevice,
    refreshDevices,
    buffer,
    setBuffer,
    running,
    paused,
    setPaused,
    start,
    stop,
    clear,
    exportLogs,
    entries,
    filters,
    setFilters,
    error,
    setError,
  } = useLogcat();

  const prefs = usePrefs();

  const [view, setView] = useState<"log" | "manage" | "tools">("log");
  const [showWifi, setShowWifi] = useState(false);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? null;

  // 生效应用 = 手动添加（优先）∪ 内置/远程（排除已删除的），按名称排序。
  const effectiveApps = useMemo(() => {
    const map = new Map<string, AppInfo>();
    for (const a of prefs.prefs.addedApps) map.set(a.package, a);
    for (const a of apps) {
      if (!map.has(a.package) && !prefs.prefs.removedPackages.includes(a.package)) {
        map.set(a.package, a);
      }
    }
    const orderIndex = new Map(
      prefs.prefs.appOrder.map((pkg, i) => [pkg, i]),
    );
    return [...map.values()].sort((a, b) => {
      const ai = orderIndex.get(a.package);
      const bi = orderIndex.get(b.package);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.name.localeCompare(b.name, "zh");
    });
  }, [
    apps,
    prefs.prefs.addedApps,
    prefs.prefs.removedPackages,
    prefs.prefs.appOrder,
  ]);

  const loadAppsList = async () => {
    try {
      setApps(await loadApps());
    } catch (e) {
      setError(String(e));
      setApps(BUILTIN_APPS);
    }
  };

  const applyAppFilter = async (pkg: string) => {
    if (!pkg) {
      setFilters({ ...filters, pid: "" });
      return;
    }
    try {
      const pids = await invoke<string[]>("resolve_pids", {
        device: selectedDevice,
        package: pkg,
      });
      if (pids.length === 0) {
        setError(`应用「${pkg}」当前未运行`);
        setFilters({ ...filters, pid: "" });
      } else {
        setError(null);
        setFilters({ ...filters, pid: pids.join(",") });
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAppChange = (pkg: string) => {
    setSelectedPackage(pkg);
    applyAppFilter(pkg);
  };

  const handleRefreshApps = async () => {
    await loadAppsList();
    if (selectedPackage) await applyAppFilter(selectedPackage);
  };

  const getBackdoor = (pkg: string) =>
    prefs.prefs.backdoorOverrides[pkg] ?? DEFAULT_BACKDOOR;

  const handleOpenBackdoor = async (pkg: string) => {
    const out = await invoke<string>("open_backdoor", {
      device: selectedDevice,
      package: pkg,
      activity: getBackdoor(pkg),
    });
    return `后门已打开：${out}`;
  };

  const handleRestartApp = async (pkg: string) => {
    await invoke("restart_app", { device: selectedDevice, package: pkg });
    return "应用已重启";
  };

  const handleClearData = async (pkg: string) => {
    const out = await invoke<string>("clear_app_data", {
      device: selectedDevice,
      package: pkg,
    });
    return `清除结果：${out}`;
  };

  const handleUninstall = async (pkg: string) => {
    const out = await invoke<string>("uninstall_app", {
      device: selectedDevice,
      package: pkg,
    });
    return `卸载结果：${out}`;
  };

  const handleScreenshot = async () => {
    const path = await invoke<string | null>("screenshot", {
      device: selectedDevice,
    });
    if (!path) return "已取消截图";
    return `截图已保存：${path}`;
  };

  const handleInstallApk = async () => {
    const path = await invoke<string | null>("pick_apk");
    if (!path) return "已取消选择 APK";
    const out = await invoke<string>("install_apk", {
      device: selectedDevice,
      path,
    });
    return `安装结果：${out}`;
  };

  const handleDeviceInfo = async () => {
    return await invoke<DeviceInfo>("device_info", { device: selectedDevice });
  };

  const handleCurrentActivity = async () => {
    return await invoke<string>("current_activity", { device: selectedDevice });
  };

  const handleStartRecording = async (mbps: number) => {
    return await invoke<string | null>("start_recording", {
      device: selectedDevice,
      mbps,
    });
  };

  const handleStopRecording = async () => {
    return await invoke<string>("stop_recording");
  };

  const handleMirror = async (mbps: number) => {
    await invoke("mirror", { device: selectedDevice, mbps });
    return "投屏已启动，请在 scrcpy 窗口中操作";
  };

  const handleAppAlarm = async (pkg: string) => {
    return await invoke<string>("app_alarm", {
      device: selectedDevice,
      package: pkg,
    });
  };

  // 挂载时加载应用清单。
  useEffect(() => {
    loadAppsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 设备切换时重新解析所选应用的 PID（PID 是设备相关的）。
  useEffect(() => {
    setFilters({ ...filters, pid: "" });
    if (selectedPackage && selectedDevice) {
      applyAppFilter(selectedPackage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice]);

  const markCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copySelected = async () => {
    if (!selectedEntry) return;
    try {
      await writeText(selectedEntry.raw);
      markCopied();
    } catch (e) {
      setError(`复制失败：${String(e)}`);
    }
  };

  const copyAll = async () => {
    try {
      await writeText(entries.map((e) => e.raw).join("\n"));
      markCopied();
    } catch (e) {
      setError(`复制失败：${String(e)}`);
    }
  };

  // 选中某行后，Cmd/Ctrl+C 复制该行；不干扰手动框选文本的复制。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const sel = window.getSelection();
        if (selectedEntry && sel && sel.isCollapsed) {
          e.preventDefault();
          writeText(selectedEntry.raw).catch((err) => setError(String(err)));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEntry, setError]);

  const handleSelect = (id: number) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  if (view === "manage") {
    return (
      <ManagePage
        prefs={prefs.prefs}
        effectiveApps={effectiveApps}
        onAddApp={(name, pkg) => prefs.addApp({ name, package: pkg })}
        onRemoveApp={(pkg) => prefs.removeApp(pkg)}
        onAddFavorite={(kind, v, d) => prefs.addFavorite(kind, v, d)}
        onRemoveFavorite={(kind, v) => prefs.removeFavorite(kind, v)}
        onUpdateFavoriteDescription={(kind, v, d) =>
          prefs.updateFavoriteDescription(kind, v, d)
        }
        onRemoveHistory={(kind, v) => prefs.removeHistory(kind, v)}
        onClearHistory={(kind) => prefs.clearHistory(kind)}
        onSetAppOrder={(order) => prefs.setAppOrder(order)}
        onSetBackdoorOverride={(pkg, a) => prefs.setBackdoorOverride(pkg, a)}
        onMoveFavorite={(kind, from, to) => prefs.moveFavorite(kind, from, to)}
        onBack={() => setView("log")}
      />
    );
  }

  if (view === "tools") {
    return (
      <ToolsPage
        apps={effectiveApps}
        hasDevice={!!selectedDevice}
        onOpenBackdoor={handleOpenBackdoor}
        onRestartApp={handleRestartApp}
        onClearData={handleClearData}
        onUninstall={handleUninstall}
        onScreenshot={handleScreenshot}
        onInstallApk={handleInstallApk}
        onDeviceInfo={handleDeviceInfo}
        onCurrentActivity={handleCurrentActivity}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
        onMirror={handleMirror}
        onAppAlarm={handleAppAlarm}
        onBack={() => setView("log")}
      />
    );
  }

  return (
    <div className="app">
      <div className="toolbar">
        <div className="toolbar-row">
          <select
            value={selectedDevice ?? ""}
            onChange={(e) => setSelectedDevice(e.target.value)}
          >
            {devices.length === 0 && <option value="">无设备</option>}
            {devices.map((d) => (
              <option key={d.serial} value={d.serial}>
                {d.model || d.serial}（{d.transport === "wifi" ? "WiFi" : "USB"}）
              </option>
            ))}
          </select>
          <button onClick={refreshDevices} title="刷新设备列表">
            刷新
          </button>

          <label>缓冲区</label>
          <select value={buffer} onChange={(e) => setBuffer(e.target.value)}>
            {BUFFERS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>

          <label>级别</label>
          <select
            value={filters.minLevel}
            onChange={(e) =>
              setFilters({ ...filters, minLevel: e.target.value as LogLevel })
            }
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>

          {running ? (
            <button onClick={stop}>停止</button>
          ) : (
            <button onClick={start} disabled={!selectedDevice}>
              开始
            </button>
          )}

          <button
            className={paused ? "active" : ""}
            onClick={() => setPaused(!paused)}
            disabled={!running}
          >
            {paused ? "继续" : "暂停"}
          </button>

          <button onClick={clear}>清空</button>
          <button onClick={exportLogs}>导出</button>
          <button onClick={copySelected} disabled={!selectedEntry}>
            复制所选
          </button>
          <button onClick={copyAll} disabled={entries.length === 0}>
            复制全部
          </button>
          {copied && <span className="count">已复制 ✓</span>}
          <button onClick={() => setShowWifi(!showWifi)}>WiFi 连接</button>
          <button onClick={() => setView("tools")}>工具</button>
          <button onClick={() => setView("manage")}>设置</button>
        </div>

        <div className="toolbar-row">
          <HistoryInput
            value={filters.search}
            onChange={(v) => setFilters({ ...filters, search: v })}
            favorites={prefs.prefs.searchFavorites}
            history={prefs.prefs.searchHistory}
            onAddHistory={(v) => prefs.addHistory("search", v)}
            onPin={(v) => prefs.addFavorite("search", v)}
            onUnpin={(v) => prefs.removeFavorite("search", v)}
            onRemoveHistory={(v) => prefs.removeHistory("search", v)}
            placeholder="搜索（消息或 Tag）"
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.regex}
              onChange={(e) =>
                setFilters({ ...filters, regex: e.target.checked })
              }
            />
            正则
          </label>
          <HistoryInput
            value={filters.tags}
            onChange={(v) => setFilters({ ...filters, tags: v })}
            favorites={prefs.prefs.tagFavorites}
            history={prefs.prefs.tagHistory}
            onAddHistory={(v) => prefs.addHistory("tags", v)}
            onPin={(v) => prefs.addFavorite("tags", v)}
            onUnpin={(v) => prefs.removeFavorite("tags", v)}
            onRemoveHistory={(v) => prefs.removeHistory("tags", v)}
            placeholder="Tag 过滤（逗号分隔）"
          />
          <label>应用</label>
          <select
            value={selectedPackage}
            onChange={(e) => handleAppChange(e.target.value)}
          >
            <option value="">全部应用</option>
            {effectiveApps.map((a) => (
              <option key={a.package} value={a.package}>
                {a.name}（{a.package}）
              </option>
            ))}
          </select>
          <button onClick={handleRefreshApps} title="重新拉取应用清单并刷新">
            刷新
          </button>
          <span className="count">{entries.length} 条</span>
        </div>

        {showWifi && <WifiPanel onChanged={refreshDevices} />}
      </div>

      <LogList
        entries={entries}
        selectedId={selectedId}
        onSelect={handleSelect}
      />

      {error && <div className="error">{error}</div>}
    </div>
  );
}
