export type LogLevel = "V" | "D" | "I" | "W" | "E" | "F" | "A";

export interface LogEntry {
  id: number;
  date: string;
  time: string;
  pid: string;
  tid: string;
  level: LogLevel;
  tag: string;
  message: string;
  raw: string;
}

export interface Device {
  serial: string;
  state: string;
  model: string;
  product: string;
  transport: "usb" | "wifi";
}

export const LEVELS: LogLevel[] = ["V", "D", "I", "W", "E", "F", "A"];

export const LEVEL_SEVERITY: Record<LogLevel, number> = {
  V: 0,
  D: 1,
  I: 2,
  W: 3,
  E: 4,
  F: 5,
  A: 6,
};

export const BUFFERS = [
  { id: "main", label: "Main" },
  { id: "system", label: "System" },
  { id: "crash", label: "Crash" },
  { id: "radio", label: "Radio" },
  { id: "events", label: "Events" },
  { id: "all", label: "All" },
];

export interface PairingInfo {
  service_name: string;
  code: string;
  payload: string;
}

export interface DeviceInfo {
  serial: string;
  brand: string;
  model: string;
  android: string;
  sdk: string;
  abi: string;
  resolution: string;
  density: string;
  battery: string;
  storage: string;
}
