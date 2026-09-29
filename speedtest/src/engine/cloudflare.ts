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
export const DEFAULT_DOWNLOAD_BYTES = 25_000_000;
export const DEFAULT_UPLOAD_CHUNKS = [1_000_000, 2_500_000, 5_000_000, 10_000_000];

export const DEFAULT_HEADERS: Record<string, string> = {
  "Cache-Control": "no-cache",
  "Referer": "https://speed.cloudflare.com/",
  "Origin": "https://speed.cloudflare.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

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
  bytes: number = DEFAULT_DOWNLOAD_BYTES
): Promise<SpeedResult> {
  signal?.throwIfAborted();
  const startTime = performance.now();
  const res = await fetch(`${DOWN_URL}?bytes=${bytes}`, {
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
  let bytesTransferred = 0;
  let lastProgressTime = 0;
  let lastBytes = 0;
  let currentSpeedMbps = 0;

  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        bytesTransferred += value.byteLength;
        const now = performance.now();
        const elapsedSinceLast = now - lastProgressTime;

        if (lastProgressTime === 0 || elapsedSinceLast >= 100) {
          const deltaBytes = lastProgressTime === 0 ? bytesTransferred : bytesTransferred - lastBytes;
          const dt = lastProgressTime === 0 ? Math.max(0.001, now - startTime) : Math.max(0.001, elapsedSinceLast);
          currentSpeedMbps = (deltaBytes * 8) / (dt * 1000);
          lastProgressTime = now;
          lastBytes = bytesTransferred;

          const totalDurationMs = Math.max(0.001, now - startTime);
          const averageSpeedMbps = (bytesTransferred * 8) / (totalDurationMs * 1000);

          onProgress?.({
            currentSpeedMbps,
            averageSpeedMbps,
            bytesTransferred,
            durationMs: totalDurationMs
          });
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      try {
        await reader.cancel();
      } catch {}
    }
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  const finalDurationMs = Math.max(0.001, performance.now() - startTime);
  const averageSpeedMbps = (bytesTransferred * 8) / (finalDurationMs * 1000);
  if (currentSpeedMbps === 0) {
    currentSpeedMbps = averageSpeedMbps;
  }

  const finalResult: SpeedResult = {
    currentSpeedMbps,
    averageSpeedMbps,
    bytesTransferred,
    durationMs: finalDurationMs
  };

  onProgress?.(finalResult);
  return finalResult;
}

export async function measureUpload(
  onProgress?: (res: SpeedResult) => void,
  signal?: AbortSignal,
  chunkSizes: number[] = DEFAULT_UPLOAD_CHUNKS
): Promise<SpeedResult> {
  signal?.throwIfAborted();
  const startTime = performance.now();
  let bytesTransferred = 0;
  let currentSpeedMbps = 0;

  for (const size of chunkSizes) {
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
    bytesTransferred += size;

    currentSpeedMbps = (size * 8) / (chunkDurationMs * 1000);
    const totalDurationMs = Math.max(0.001, chunkEnd - startTime);
    const averageSpeedMbps = (bytesTransferred * 8) / (totalDurationMs * 1000);

    onProgress?.({
      currentSpeedMbps,
      averageSpeedMbps,
      bytesTransferred,
      durationMs: totalDurationMs
    });
  }

  const totalDurationMs = Math.max(0.001, performance.now() - startTime);
  const averageSpeedMbps = (bytesTransferred * 8) / (totalDurationMs * 1000);
  if (currentSpeedMbps === 0) {
    currentSpeedMbps = averageSpeedMbps;
  }

  return {
    currentSpeedMbps,
    averageSpeedMbps,
    bytesTransferred,
    durationMs: totalDurationMs
  };
}

export async function runSpeedtest(
  onUpdate: (state: SpeedtestState) => void,
  signal?: AbortSignal
): Promise<SpeedtestState> {
  let state: SpeedtestState = {
    phase: "discovering",
    progressPercent: 0,
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

    // Stage 3: Download
    signal?.throwIfAborted();
    const download = await measureDownload((dl) => {
      const dlProgress = Math.min(1, dl.bytesTransferred / DEFAULT_DOWNLOAD_BYTES);
      state = {
        ...state,
        phase: "download",
        progressPercent: Math.round(25 + dlProgress * 45),
        download: dl
      };
      onUpdate(state);
    }, signal);

    state = {
      ...state,
      phase: "upload",
      progressPercent: 70,
      download
    };
    onUpdate(state);

    // Stage 4: Upload
    signal?.throwIfAborted();
    const totalUploadTarget = DEFAULT_UPLOAD_CHUNKS.reduce((acc, s) => acc + s, 0);
    const upload = await measureUpload((ul) => {
      const ulProgress = Math.min(1, ul.bytesTransferred / totalUploadTarget);
      state = {
        ...state,
        phase: "upload",
        progressPercent: Math.round(70 + ulProgress * 30),
        upload: ul
      };
      onUpdate(state);
    }, signal);

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
