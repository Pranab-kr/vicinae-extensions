export type SpeedtestPhase =
  | "idle"
  | "discovering"
  | "ping"
  | "download"
  | "upload"
  | "complete"
  | "error"
  | "aborted";

export interface ServerMetadata {
  ip: string;
  asn?: number;
  isp?: string;
  city?: string;
  country?: string;
  colo?: string;
}

export interface PingResult {
  min: number;
  avg: number;
  jitter: number;
  samples: number[];
}

export interface SpeedResult {
  currentSpeedMbps: number;
  averageSpeedMbps: number;
  bytesTransferred: number;
  durationMs: number;
}

export interface SpeedtestState {
  phase: SpeedtestPhase;
  progressPercent: number;
  server?: ServerMetadata;
  ping?: PingResult;
  currentPing?: number;
  download?: SpeedResult;
  upload?: SpeedResult;
  error?: string;
  startTime?: number;
  endTime?: number;
}
