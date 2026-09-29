import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverMetadata,
  measureLatency,
  measureDownload,
  measureUpload,
  runSpeedtest
} from "../src/engine/cloudflare";
import type { SpeedtestState } from "../src/engine/types";

function createMockReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    }
  });
}

describe("cloudflare engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("discoverMetadata", () => {
    it("parses server metadata from /meta correctly", async () => {
      const mockMeta = {
        clientIp: "1.2.3.4",
        asn: 13335,
        asOrganization: "Cloudflare, Inc.",
        city: "San Francisco",
        country: "US",
        colo: "SFO"
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockMeta
      } as any);

      const meta = await discoverMetadata();
      expect(meta.ip).toBe("1.2.3.4");
      expect(meta.isp).toBe("Cloudflare, Inc.");
      expect(meta.colo).toBe("SFO");
      expect(meta.city).toBe("San Francisco");
      expect(meta.country).toBe("US");
      expect(meta.asn).toBe(13335);
    });

    it("sends Referer and Origin headers in metadata discovery request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clientIp: "1.1.1.1" })
      } as any);

      await discoverMetadata();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/meta"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Referer: "https://speed.cloudflare.com/",
            Origin: "https://speed.cloudflare.com"
          })
        })
      );
    });

    it("handles object colo structure from Cloudflare /meta correctly", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clientIp: "1.2.3.4",
          colo: { iata: "BOM", city: "Mumbai" }
        })
      } as any);

      const meta = await discoverMetadata();
      expect(meta.colo).toBe("BOM (Mumbai)");
    });

    it("falls back to DOWN_URL headers when /meta returns 403 Forbidden", async () => {
      const headerMap = new Map<string, string>([
        ["cf-meta-ip", "202.142.73.155"],
        ["colo", "BOM"],
        ["asn", "132115"],
        ["city", "Howrah"],
        ["country", "IN"]
      ]);

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: "Forbidden"
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: (k: string) => headerMap.get(k.toLowerCase()) ?? null
          },
          arrayBuffer: async () => new ArrayBuffer(0)
        } as any);

      const meta = await discoverMetadata();
      expect(meta.ip).toBe("202.142.73.155");
      expect(meta.colo).toBe("BOM");
      expect(meta.asn).toBe(132115);
      expect(meta.city).toBe("Howrah");
      expect(meta.country).toBe("IN");
    });

    it("throws error when both metadata request and fallback probe fail", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error"
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error"
        } as any);

      await expect(discoverMetadata()).rejects.toThrow("Failed to discover metadata");
    });

    it("handles abort signals during metadata discovery", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(discoverMetadata(controller.signal)).rejects.toThrow();
    });
  });

  describe("measureLatency", () => {
    it("measures latency across 8 probes and computes jitter", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(0)
        } as any;
      });

      const progressCalls: Array<{ progress: number; ping: number }> = [];
      const result = await measureLatency((p, ping) => {
        progressCalls.push({ progress: p, ping });
      });

      expect(fetchSpy).toHaveBeenCalledTimes(8);
      expect(progressCalls).toHaveLength(8);
      expect(progressCalls[7].progress).toBe(1);
      expect(result.samples).toHaveLength(8);
      expect(result.min).toBeGreaterThanOrEqual(0);
      expect(result.avg).toBeGreaterThanOrEqual(result.min);
      expect(result.jitter).toBeGreaterThanOrEqual(0);
    });

    it("throws error if latency probe fails", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway"
      } as any);

      await expect(measureLatency(() => {})).rejects.toThrow("Latency probe failed");
    });

    it("handles abort signals during latency measurement", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(measureLatency(() => {}, controller.signal)).rejects.toThrow();
    });
  });

  describe("measureDownload", () => {
    it("measures download speed using stream chunks", async () => {
      const chunk1 = new Uint8Array(125000);
      const chunk2 = new Uint8Array(250000);
      const stream = createMockReadableStream([chunk1, chunk2]);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        body: stream
      } as any);

      const progressReports: any[] = [];
      const result = await measureDownload(
        (res) => {
          progressReports.push({ ...res });
        },
        undefined,
        375000
      );

      expect(result.bytesTransferred).toBe(375000);
      expect(result.averageSpeedMbps).toBeGreaterThan(0);
      expect(progressReports.length).toBeGreaterThanOrEqual(1);
      expect(progressReports[progressReports.length - 1].bytesTransferred).toBe(375000);
    });

    it("throws error when download stream request fails", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found"
      } as any);

      await expect(measureDownload(() => {})).rejects.toThrow("Download stream request failed");
    });

    it("handles abort signals during download", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(measureDownload(() => {}, controller.signal)).rejects.toThrow();
    });
  });

  describe("measureUpload", () => {
    it("measures upload speed by streaming POST chunks", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(0)
        } as any;
      });

      const progressReports: any[] = [];
      const testChunks = [10000, 20000];
      const result = await measureUpload(
        (res) => {
          progressReports.push({ ...res });
        },
        undefined,
        testChunks
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.bytesTransferred).toBe(30000);
      expect(progressReports).toHaveLength(2);
      expect(progressReports[1].bytesTransferred).toBe(30000);
    });

    it("handles abort signals during upload", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(measureUpload(() => {}, controller.signal)).rejects.toThrow();
    });

    it("throws error if upload request fails", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error"
      } as any);

      await expect(measureUpload(() => {}, undefined, [1000])).rejects.toThrow("Upload chunk request failed");
    });

    it("drains response body via arrayBuffer after each upload chunk", async () => {
      const arrayBufferMock = vi.fn().mockResolvedValue(new ArrayBuffer(0));
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        arrayBuffer: arrayBufferMock
      } as any);

      await measureUpload(undefined, undefined, [1000, 2000]);
      expect(arrayBufferMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("runSpeedtest", () => {
    it("runs full speedtest sequence across all 4 stages to completion", async () => {
      const mockMeta = {
        clientIp: "8.8.8.8",
        asn: 15169,
        asOrganization: "Google LLC",
        city: "Mountain View",
        country: "US",
        colo: "SJC"
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/meta")) {
          return { ok: true, json: async () => mockMeta } as any;
        }
        if (urlStr.includes("__down?bytes=0")) {
          return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as any;
        }
        if (urlStr.includes("__down?bytes=")) {
          return {
            ok: true,
            body: createMockReadableStream([new Uint8Array(100000), new Uint8Array(100000)])
          } as any;
        }
        if (urlStr.includes("/__up")) {
          return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as any;
        }
        return { ok: true } as any;
      });

      const states: SpeedtestState[] = [];
      const finalState = await runSpeedtest((state) => {
        states.push({ ...state });
      });

      expect(finalState.phase).toBe("complete");
      expect(finalState.progressPercent).toBe(100);
      expect(finalState.server?.ip).toBe("8.8.8.8");
      expect(finalState.ping).toBeDefined();
      expect(finalState.download).toBeDefined();
      expect(finalState.upload).toBeDefined();
      expect(finalState.startTime).toBeDefined();
      expect(finalState.endTime).toBeDefined();

      const phases = states.map((s) => s.phase);
      expect(phases).toContain("discovering");
      expect(phases).toContain("ping");
      expect(phases).toContain("download");
      expect(phases).toContain("upload");
      expect(phases).toContain("complete");
    });

    it("handles abort signal during runSpeedtest and updates state to aborted", async () => {
      const controller = new AbortController();
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/meta")) {
          controller.abort();
          throw controller.signal.reason ?? new Error("Aborted");
        }
        return { ok: true } as any;
      });

      const states: SpeedtestState[] = [];
      await expect(
        runSpeedtest((s) => states.push({ ...s }), controller.signal)
      ).rejects.toThrow();

      const lastState = states[states.length - 1];
      expect(lastState.phase).toBe("aborted");
      expect(lastState.error).toBeDefined();
    });

    it("handles unexpected error during runSpeedtest and updates state to error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network connection lost"));

      const states: SpeedtestState[] = [];
      await expect(
        runSpeedtest((s) => states.push({ ...s }))
      ).rejects.toThrow("Network connection lost");

      const lastState = states[states.length - 1];
      expect(lastState.phase).toBe("error");
      expect(lastState.error).toContain("Network connection lost");
    });
  });
});
