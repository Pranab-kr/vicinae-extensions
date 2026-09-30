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
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.floor(width) : 16;
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(current) || current <= 0) {
    if (current === Infinity && Number.isFinite(max) && max > 0) {
      return `[${"█".repeat(safeWidth)}]`;
    }
    return `[${"░".repeat(safeWidth)}]`;
  }
  const clamped = Math.max(0, Math.min(current, max));
  const ratio = clamped / max;
  const filledCount = Math.min(safeWidth, Math.max(0, Math.round(ratio * safeWidth)));
  const emptyCount = Math.max(0, safeWidth - filledCount);
  return `[${"█".repeat(filledCount)}${"░".repeat(emptyCount)}]`;
}

export interface SpeedSample {
  timestamp: number;
  totalBytes: number;
}

export const DEFAULT_SPEED_WINDOW_MS = 1200;

export function calculateWindowSpeed(
  samples: SpeedSample[],
  now: number,
  startTime: number,
  totalBytes: number,
  windowMs: number = DEFAULT_SPEED_WINDOW_MS
): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;

  // Prune samples older than (now - windowMs), keeping the sample at or just before the cutoff
  while (samples.length > 2 && samples[1].timestamp < now - windowMs) {
    samples.shift();
  }

  const base = samples.length > 0 ? samples[0] : null;
  const dt = base ? Math.max(0.001, now - base.timestamp) : Math.max(0.001, now - startTime);
  const deltaBytes = base ? Math.max(0, totalBytes - base.totalBytes) : totalBytes;

  if (dt < 100) {
    const totalDt = Math.max(1, now - startTime);
    return (totalBytes * 8) / (totalDt * 1000);
  }

  return (deltaBytes * 8) / (dt * 1000);
}

