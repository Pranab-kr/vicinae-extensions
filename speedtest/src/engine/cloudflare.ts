import type {
  ServerMetadata,
  PingResult,
  SpeedResult,
  SpeedtestState
} from "./types";
import { calculateJitter } from "./utils";

export const SPEEDTEST_BASE_URL = "https://speed.cloudflare.com";
export const META_URL = `${SPEEDTEST_BASE_URL}/meta`;
export const DOWN_URL = `${SPEEDTEST_BASE_URL}/__down`;
export const UP_URL = `${SPEEDTEST_BASE_URL}/__up`;

export const DEFAULT_LATENCY_PROBES = 8;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_PHASE_DURATION_MS = 8000;
export const CHUNK_DOWNLOAD_BYTES = 10_000_000;
export const CHUNK_UPLOAD_BYTES = 2_500_000;
export const DEFAULT_DOWNLOAD_BYTES = 25_000_000;
export const DEFAULT_UPLOAD_CHUNKS = [1_000_000, 2_500_000, 5_000_000, 10_000_000];

export interface StreamTestOptions {
  durationMs?: number;
  concurrency?: number;
  bytes?: number;
  chunkSizes?: number[];
}

export const DEFAULT_HEADERS: Record<string, string> = {
  "Cache-Control": "no-cache",
  "Referer": "https://speed.cloudflare.com/",
  "Origin": "https://speed.cloudflare.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

export const EMA_ALPHA = 0.25;
export const WARMUP_RATIO = 0.2;
export const WARMUP_MAX_MS = 1500;
export const MIN_SUSTAINED_DURATION_MS = 3000;

export async function discoverMetadata(signal?: AbortSignal): Promise<ServerMetadata> {
  signal?.throwIfAborted();
  try {
    const response = await fetch(META_URL, {
      signal,
      headers: DEFAULT_HEADERS
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      let colo: string | undefined;
      if (typeof data.colo === "object" && data.colo !== null) {
        if (data.colo.iata) {
          colo = data.colo.city ? `${data.colo.iata} (${data.colo.city})` : data.colo.iata;
        } else {
          colo = data.colo.city || undefined;
        }
      } else if (typeof data.colo === "string") {
        colo = data.colo;
      }

      return {
        ip: data.clientIp || data.ip || "",
        asn: data.asn ? Number(data.asn) : undefined,
        isp: data.asOrganization || data.isp,
        city: data.city,
        country: data.country,
        colo
      };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
  }

  // Fallback: discover via headers from DOWN_URL probe
  signal?.throwIfAborted();
  const fallbackRes = await fetch(`${DOWN_URL}?bytes=0`, {
    signal,
    headers: DEFAULT_HEADERS
  });

  if (!fallbackRes.ok) {
    throw new Error(`Failed to discover metadata: ${fallbackRes.status} ${fallbackRes.statusText}`);
  }

  await fallbackRes.arrayBuffer();

  const ip = fallbackRes.headers.get("cf-meta-ip") || "";
  const asnStr = fallbackRes.headers.get("asn");
  const asn = asnStr ? Number.parseInt(asnStr, 10) : undefined;
  const city = fallbackRes.headers.get("city") || undefined;
  const country = fallbackRes.headers.get("country") || undefined;
  const colo = fallbackRes.headers.get("colo") || undefined;

  return {
    ip,
    asn,
    city,
    country,
    colo
  };
}

export async function measureLatency(
  onProgress?: (progress: number, currentPing: number) => void,
  signal?: AbortSignal,
  probeCount: number = DEFAULT_LATENCY_PROBES
): Promise<PingResult> {
  signal?.throwIfAborted();
  const samples: number[] = [];

  for (let i = 0; i < probeCount; i++) {
    signal?.throwIfAborted();
    const start = performance.now();
    const res = await fetch(`${DOWN_URL}?bytes=0`, {
      signal,
      headers: DEFAULT_HEADERS
    });

    if (!res.ok) {
      throw new Error(`Latency probe failed: ${res.status} ${res.statusText}`);
    }

    await res.arrayBuffer();
    const rtt = performance.now() - start;
    samples.push(rtt);

    onProgress?.((i + 1) / probeCount, rtt);
  }

  const min = samples.length > 0 ? Math.min(...samples) : 0;
  const avg = samples.length > 0 ? samples.reduce((acc, v) => acc + v, 0) / samples.length : 0;
  const jitter = calculateJitter(samples);

  return {
    min,
    avg,
    jitter,
    samples
  };
}

export async function measureDownload(
  onProgress?: (res: SpeedResult) => void,
  signal?: AbortSignal,
  options?: number | StreamTestOptions
): Promise<SpeedResult> {
  signal?.throwIfAborted();

  const isLegacyBytes = typeof options === "number";
  const targetBytes = isLegacyBytes ? options : options?.bytes;
  const concurrency = isLegacyBytes ? 1 : (options?.concurrency ?? DEFAULT_CONCURRENCY);
  const durationMs =
    isLegacyBytes || targetBytes !== undefined
      ? Number.POSITIVE_INFINITY
      : (options?.durationMs ?? DEFAULT_PHASE_DURATION_MS);

  const startTime = performance.now();
  let totalBytesTransferred = 0;
  let lastProgressTime = 0;
  let lastBytes = 0;
  let currentSpeedMbps = 0;
  const activeReaders = new Set<ReadableStreamDefaultReader<Uint8Array>>();

  const isSustained = durationMs >= MIN_SUSTAINED_DURATION_MS && Number.isFinite(durationMs);
  const warmUpDurationMs = isSustained ? Math.min(WARMUP_MAX_MS, durationMs * WARMUP_RATIO) : 0;
  let warmUpBytes = 0;
  let warmUpTime = 0;

  const updateProgress = (now: number) => {
    const elapsedSinceLast = now - lastProgressTime;
    if (lastProgressTime === 0 || elapsedSinceLast >= 100) {
      const deltaBytes = lastProgressTime === 0 ? totalBytesTransferred : totalBytesTransferred - lastBytes;
      const dt = lastProgressTime === 0 ? Math.max(0.001, now - startTime) : Math.max(0.001, elapsedSinceLast);
      const instantSpeed = (deltaBytes * 8) / (dt * 1000);

      if (currentSpeedMbps === 0) {
        currentSpeedMbps = instantSpeed;
      } else {
        currentSpeedMbps = currentSpeedMbps * (1 - EMA_ALPHA) + instantSpeed * EMA_ALPHA;
      }

      lastProgressTime = now;
      lastBytes = totalBytesTransferred;

      const totalDurationMs = Math.max(0.001, now - startTime);
      let averageSpeedMbps = (totalBytesTransferred * 8) / (totalDurationMs * 1000);

      if (isSustained) {
        if (totalDurationMs < warmUpDurationMs) {
          warmUpBytes = totalBytesTransferred;
          warmUpTime = totalDurationMs;
        } else {
          const stableBytes = totalBytesTransferred - warmUpBytes;
          const stableDurationMs = totalDurationMs - warmUpTime;
          if (stableDurationMs > 100 && stableBytes > 0) {
            averageSpeedMbps = (stableBytes * 8) / (stableDurationMs * 1000);
          }
        }
      }

      onProgress?.({
        currentSpeedMbps,
        averageSpeedMbps,
        bytesTransferred: totalBytesTransferred,
        durationMs: totalDurationMs,
        concurrency
      });
    }
  };

  const runWorker = async () => {
    while (!signal?.aborted) {
      const now = performance.now();
      if (now - startTime >= durationMs) break;
      if (targetBytes !== undefined && totalBytesTransferred >= targetBytes) break;

      const bytesToRequest =
        targetBytes !== undefined
          ? Math.min(CHUNK_DOWNLOAD_BYTES, Math.max(1000, targetBytes - totalBytesTransferred))
          : CHUNK_DOWNLOAD_BYTES;

      const res = await fetch(`${DOWN_URL}?bytes=${bytesToRequest}`, {
        signal,
        headers: DEFAULT_HEADERS
      });

      if (!res.ok) {
        throw new Error(`Download stream request failed: ${res.status} ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error("Download response body is not readable");
      }

      const reader = res.body.getReader();
      activeReaders.add(reader);

      try {
        while (true) {
          if (signal?.aborted) break;
          const currentNow = performance.now();
          if (currentNow - startTime >= durationMs) break;
          if (targetBytes !== undefined && totalBytesTransferred >= targetBytes) break;

          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            totalBytesTransferred += value.byteLength;
            updateProgress(performance.now());
          }
        }
      } finally {
        activeReaders.delete(reader);
        try {
          await reader.cancel();
        } catch {}
        try {
          reader.releaseLock();
        } catch {}
      }
    }
  };

  try {
    const workers = Array.from({ length: concurrency }, () => runWorker());
    await Promise.all(workers);
  } catch (err) {
    for (const reader of activeReaders) {
      try {
        await reader.cancel();
      } catch {}
      try {
        reader.releaseLock();
      } catch {}
    }
    throw err;
  }

  const finalDurationMs = Math.max(0.001, performance.now() - startTime);
  let averageSpeedMbps = (totalBytesTransferred * 8) / (finalDurationMs * 1000);
  if (isSustained && finalDurationMs > warmUpDurationMs) {
    const stableBytes = totalBytesTransferred - warmUpBytes;
    const stableDurationMs = finalDurationMs - warmUpTime;
    if (stableDurationMs > 100 && stableBytes > 0) {
      averageSpeedMbps = (stableBytes * 8) / (stableDurationMs * 1000);
    }
  }

  if (currentSpeedMbps === 0) {
    currentSpeedMbps = averageSpeedMbps;
  }

  const finalResult: SpeedResult = {
    currentSpeedMbps,
    averageSpeedMbps,
    bytesTransferred: totalBytesTransferred,
    durationMs: finalDurationMs,
    concurrency
  };

  onProgress?.(finalResult);
  return finalResult;
}

export async function measureUpload(
  onProgress?: (res: SpeedResult) => void,
  signal?: AbortSignal,
  options?: number[] | StreamTestOptions
): Promise<SpeedResult> {
  signal?.throwIfAborted();

  const isLegacyChunks = Array.isArray(options);
  const fixedChunks = isLegacyChunks ? options : options?.chunkSizes;
  const concurrency = isLegacyChunks ? 1 : (options?.concurrency ?? DEFAULT_CONCURRENCY);
  const durationMs =
    isLegacyChunks || fixedChunks !== undefined
      ? Number.POSITIVE_INFINITY
      : (options?.durationMs ?? DEFAULT_PHASE_DURATION_MS);

  const startTime = performance.now();
  let totalBytesTransferred = 0;
  let lastProgressTime = 0;
  let lastBytes = 0;
  let currentSpeedMbps = 0;

  const isSustained = durationMs >= MIN_SUSTAINED_DURATION_MS && Number.isFinite(durationMs);
  const warmUpDurationMs = isSustained ? Math.min(WARMUP_MAX_MS, durationMs * WARMUP_RATIO) : 0;
  let warmUpBytes = 0;
  let warmUpTime = 0;

  const updateProgress = (now: number) => {
    const elapsedSinceLast = now - lastProgressTime;
    if (lastProgressTime === 0 || elapsedSinceLast >= 100) {
      const deltaBytes = lastProgressTime === 0 ? totalBytesTransferred : totalBytesTransferred - lastBytes;
      const dt = lastProgressTime === 0 ? Math.max(0.001, now - startTime) : Math.max(0.001, elapsedSinceLast);
      const instantSpeed = (deltaBytes * 8) / (dt * 1000);

      if (currentSpeedMbps === 0) {
        currentSpeedMbps = instantSpeed;
      } else {
        currentSpeedMbps = currentSpeedMbps * (1 - EMA_ALPHA) + instantSpeed * EMA_ALPHA;
      }

      lastProgressTime = now;
      lastBytes = totalBytesTransferred;

      const totalDurationMs = Math.max(0.001, now - startTime);
      let averageSpeedMbps = (totalBytesTransferred * 8) / (totalDurationMs * 1000);

      if (isSustained) {
        if (totalDurationMs < warmUpDurationMs) {
          warmUpBytes = totalBytesTransferred;
          warmUpTime = totalDurationMs;
        } else {
          const stableBytes = totalBytesTransferred - warmUpBytes;
          const stableDurationMs = totalDurationMs - warmUpTime;
          if (stableDurationMs > 100 && stableBytes > 0) {
            averageSpeedMbps = (stableBytes * 8) / (stableDurationMs * 1000);
          }
        }
      }

      onProgress?.({
        currentSpeedMbps,
        averageSpeedMbps,
        bytesTransferred: totalBytesTransferred,
        durationMs: totalDurationMs,
        concurrency
      });
    }
  };

  if (fixedChunks) {
    for (const size of fixedChunks) {
      signal?.throwIfAborted();
      const chunk = new Uint8Array(size);
      const chunkStart = performance.now();

      const res = await fetch(UP_URL, {
        method: "POST",
        headers: DEFAULT_HEADERS,
        body: chunk,
        signal
      });

      if (!res.ok) {
        throw new Error(`Upload chunk request failed: ${res.status} ${res.statusText}`);
      }

      await res.arrayBuffer();

      const chunkEnd = performance.now();
      const chunkDurationMs = Math.max(0.001, chunkEnd - chunkStart);
      totalBytesTransferred += size;

      currentSpeedMbps = (size * 8) / (chunkDurationMs * 1000);
      const totalDurationMs = Math.max(0.001, chunkEnd - startTime);
      const averageSpeedMbps = (totalBytesTransferred * 8) / (totalDurationMs * 1000);

      onProgress?.({
        currentSpeedMbps,
        averageSpeedMbps,
        bytesTransferred: totalBytesTransferred,
        durationMs: totalDurationMs,
        concurrency: 1
      });
    }
  } else {
    const runWorker = async () => {
      while (!signal?.aborted) {
        const now = performance.now();
        if (now - startTime >= durationMs) break;

        const chunk = new Uint8Array(CHUNK_UPLOAD_BYTES);
        const res = await fetch(UP_URL, {
          method: "POST",
          headers: DEFAULT_HEADERS,
          body: chunk,
          signal
        });

        if (!res.ok) {
          throw new Error(`Upload chunk request failed: ${res.status} ${res.statusText}`);
        }

        await res.arrayBuffer();
        totalBytesTransferred += CHUNK_UPLOAD_BYTES;
        updateProgress(performance.now());
      }
    };

    const workers = Array.from({ length: concurrency }, () => runWorker());
    await Promise.all(workers);
  }

  const totalDurationMs = Math.max(0.001, performance.now() - startTime);
  let averageSpeedMbps = (totalBytesTransferred * 8) / (totalDurationMs * 1000);
  if (isSustained && totalDurationMs > warmUpDurationMs) {
    const stableBytes = totalBytesTransferred - warmUpBytes;
    const stableDurationMs = totalDurationMs - warmUpTime;
    if (stableDurationMs > 100 && stableBytes > 0) {
      averageSpeedMbps = (stableBytes * 8) / (stableDurationMs * 1000);
    }
  }

  if (currentSpeedMbps === 0) {
    currentSpeedMbps = averageSpeedMbps;
  }

  const finalResult: SpeedResult = {
    currentSpeedMbps,
    averageSpeedMbps,
    bytesTransferred: totalBytesTransferred,
    durationMs: totalDurationMs,
    concurrency
  };

  if (!fixedChunks) {
    onProgress?.(finalResult);
  }
  return finalResult;
}

export async function runSpeedtest(
  onUpdate: (state: SpeedtestState) => void,
  signal?: AbortSignal,
  options?: StreamTestOptions
): Promise<SpeedtestState> {
  const durationMs = options?.durationMs ?? DEFAULT_PHASE_DURATION_MS;
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;

  let state: SpeedtestState = {
    phase: "discovering",
    progressPercent: 0,
    concurrency,
    startTime: Date.now()
  };

  try {
    signal?.throwIfAborted();
    onUpdate(state);

    // Stage 1: Discovery
    const server = await discoverMetadata(signal);
    state = {
      ...state,
      phase: "ping",
      progressPercent: 10,
      server
    };
    onUpdate(state);

    // Stage 2: Latency
    signal?.throwIfAborted();
    const ping = await measureLatency((progress, currentPing) => {
      state = {
        ...state,
        phase: "ping",
        progressPercent: Math.round(10 + progress * 15),
        currentPing
      };
      onUpdate(state);
    }, signal);

    state = {
      ...state,
      phase: "download",
      progressPercent: 25,
      ping,
      currentPing: undefined
    };
    onUpdate(state);

    // Stage 3: Multi-stream sustained download
    signal?.throwIfAborted();
    const download = await measureDownload(
      (dl) => {
        const elapsedRatio = Math.min(1, dl.durationMs / durationMs);
        state = {
          ...state,
          phase: "download",
          progressPercent: Math.min(65, Math.round(25 + elapsedRatio * 40)),
          download: dl
        };
        onUpdate(state);
      },
      signal,
      { durationMs, concurrency, bytes: options?.bytes }
    );

    state = {
      ...state,
      phase: "upload",
      progressPercent: 65,
      download
    };
    onUpdate(state);

    // Stage 4: Multi-stream sustained upload
    signal?.throwIfAborted();
    const upload = await measureUpload(
      (ul) => {
        const elapsedRatio = Math.min(1, ul.durationMs / durationMs);
        state = {
          ...state,
          phase: "upload",
          progressPercent: Math.min(100, Math.round(65 + elapsedRatio * 35)),
          upload: ul
        };
        onUpdate(state);
      },
      signal,
      { durationMs, concurrency, chunkSizes: options?.chunkSizes }
    );

    state = {
      ...state,
      phase: "complete",
      progressPercent: 100,
      upload,
      endTime: Date.now()
    };
    onUpdate(state);

    return state;
  } catch (err: any) {
    const isAborted =
      signal?.aborted ||
      err?.name === "AbortError" ||
      (typeof err?.message === "string" && err.message.toLowerCase().includes("abort"));

    state = {
      ...state,
      phase: isAborted ? "aborted" : "error",
      error: isAborted ? "Speedtest cancelled" : (err instanceof Error ? err.message : String(err)),
      endTime: Date.now()
    };
    onUpdate(state);
    throw err;
  }
}

