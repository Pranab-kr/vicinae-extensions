export function formatSpeed(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return "0.0 Mbps";
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(2)} Gbps`;
  }
  return `${mbps.toFixed(1)} Mbps`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unitIndex = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function calculateJitter(samples: number[]): number {
  if (samples.length < 2) return 0;
  let totalDiff = 0;
  for (let i = 1; i < samples.length; i++) {
    totalDiff += Math.abs(samples[i] - samples[i - 1]);
  }
  return totalDiff / (samples.length - 1);
}

export function renderGauge(current: number, max: number, width: number = 16): string {
  const clamped = Math.max(0, Math.min(current, max));
  const ratio = max > 0 ? clamped / max : 0;
  const filledCount = Math.round(ratio * width);
  const emptyCount = Math.max(0, width - filledCount);
  return `[${"█".repeat(filledCount)}${"░".repeat(emptyCount)}]`;
}
