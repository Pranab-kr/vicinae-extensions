import "./setup";
import { describe, it, expect } from "vitest";
import { Color } from "@vicinae/api";
import {
  getStatusTag,
  buildMarkdown,
  generateSummaryMarkdown,
  generateSummaryJson
} from "../src/index";
import type { SpeedtestState } from "../src/engine/types";

describe("index view helpers", () => {
  describe("getStatusTag", () => {
    it("returns correct tag text and color for each phase", () => {
      expect(getStatusTag("idle")).toEqual({ text: "Idle", color: Color.SecondaryText });
      expect(getStatusTag("discovering")).toEqual({ text: "Discovering Server", color: Color.Yellow });
      expect(getStatusTag("ping")).toEqual({ text: "Measuring Latency", color: Color.Yellow });
      expect(getStatusTag("download")).toEqual({ text: "Testing Download", color: Color.Blue });
      expect(getStatusTag("upload")).toEqual({ text: "Testing Upload", color: Color.Purple });
      expect(getStatusTag("complete")).toEqual({ text: "Complete", color: Color.Green });
      expect(getStatusTag("error")).toEqual({ text: "Failed", color: Color.Red });
      expect(getStatusTag("aborted")).toEqual({ text: "Cancelled", color: Color.Orange });
    });
  });

  describe("buildMarkdown", () => {
    it("renders idle state markdown", () => {
      const state: SpeedtestState = {
        phase: "idle",
        progressPercent: 0
      };
      const md = buildMarkdown(state);
      expect(md).toContain("# Speedtest");
      expect(md).toContain("Restart Test");
      expect(md).toContain("Cloudflare Edge");
    });

    it("renders discovering state markdown with server placeholder", () => {
      const state: SpeedtestState = {
        phase: "discovering",
        progressPercent: 5
      };
      const md = buildMarkdown(state);
      expect(md).toContain("# Speedtest");
      expect(md).toContain("Locating server...");
      expect(md).toContain("Cloudflare Edge");
    });

    it("renders ping state markdown with current probe", () => {
      const state: SpeedtestState = {
        phase: "ping",
        progressPercent: 15,
        currentPing: 18.4,
        server: {
          ip: "1.1.1.1",
          isp: "Cloudflare",
          city: "San Francisco",
          country: "US",
          colo: "SFO",
          asn: 13335
        }
      };
      const md = buildMarkdown(state);
      expect(md).toContain("# Speedtest");
      expect(md).toContain("18.4 ms");
      expect(md).toContain("Measuring latency & jitter");
      expect(md).toContain("15%");
      expect(md).toContain("Cloudflare SFO (San Francisco, US)");
    });

    it("renders download state markdown with streaming telemetry", () => {
      const state: SpeedtestState = {
        phase: "download",
        progressPercent: 50,
        ping: { min: 10, avg: 12.5, jitter: 1.5, samples: [10, 15] },
        download: {
          currentSpeedMbps: 120.4,
          averageSpeedMbps: 110.2,
          bytesTransferred: 12500000,
          durationMs: 900
        }
      };
      const md = buildMarkdown(state);
      expect(md).toContain("# Speedtest");
      expect(md).toContain("### ⬇️ 120.4 Mbps");
      expect(md).toContain("Testing download speed");
      expect(md).toContain("50%");
      expect(md).toContain("12.5 ms");
    });

    it("renders upload state markdown with completed download", () => {
      const state: SpeedtestState = {
        phase: "upload",
        progressPercent: 85,
        ping: { min: 10, avg: 12, jitter: 1, samples: [11, 13] },
        download: {
          currentSpeedMbps: 100,
          averageSpeedMbps: 100,
          bytesTransferred: 25000000,
          durationMs: 2000
        },
        upload: {
          currentSpeedMbps: 45.6,
          averageSpeedMbps: 40.2,
          bytesTransferred: 5000000,
          durationMs: 1000
        }
      };
      const md = buildMarkdown(state);
      expect(md).toContain("# Speedtest");
      expect(md).toContain("### ⬆️ 45.6 Mbps");
      expect(md).toContain("Testing upload speed");
      expect(md).toContain("85%");
      expect(md).toContain("100.0 Mbps");
      expect(md).toContain("12.0 ms");
    });

    it("renders complete state markdown", () => {
      const state: SpeedtestState = {
        phase: "complete",
        progressPercent: 100,
        ping: { min: 8, avg: 10.2, jitter: 0.8, samples: [10, 10.5] },
        download: {
          currentSpeedMbps: 200,
          averageSpeedMbps: 200,
          bytesTransferred: 25000000,
          durationMs: 1000
        },
        upload: {
          currentSpeedMbps: 50,
          averageSpeedMbps: 50,
          bytesTransferred: 18500000,
          durationMs: 2960
        },
        server: {
          ip: "104.16.1.1",
          isp: "Cloudflare, Inc.",
          colo: "IAD",
          city: "Ashburn",
          country: "US"
        },
        endTime: 1700000000000
      };
      const md = buildMarkdown(state);
      expect(md).toContain("# Speedtest Results");
      expect(md).toContain("200.0 Mbps");
      expect(md).toContain("50.0 Mbps");
      expect(md).toContain("10.2 ms");
      expect(md).toContain("0.8 ms jitter");
      expect(md).toContain("Cloudflare IAD (Ashburn, US)");
      expect(md).toContain("Cloudflare, Inc.");
    });

    it("renders error and aborted states correctly", () => {
      const errorState: SpeedtestState = {
        phase: "error",
        progressPercent: 30,
        error: "Connection timeout"
      };
      const errMd = buildMarkdown(errorState);
      expect(errMd).toContain("Speedtest Failed");
      expect(errMd).toContain("Connection timeout");

      const abortState: SpeedtestState = {
        phase: "aborted",
        progressPercent: 45,
        error: "Speedtest cancelled"
      };
      const abortMd = buildMarkdown(abortState);
      expect(abortMd).toContain("Speedtest Cancelled");
    });
  });

  describe("generateSummaryMarkdown", () => {
    it("formats summary markdown for completed state", () => {
      const state: SpeedtestState = {
        phase: "complete",
        progressPercent: 100,
        download: {
          currentSpeedMbps: 150,
          averageSpeedMbps: 150,
          bytesTransferred: 25000000,
          durationMs: 1333
        },
        upload: {
          currentSpeedMbps: 45,
          averageSpeedMbps: 45,
          bytesTransferred: 18500000,
          durationMs: 3288
        },
        ping: {
          min: 9.5,
          avg: 11.2,
          jitter: 1.1,
          samples: [10, 12]
        },
        server: {
          ip: "1.2.3.4",
          isp: "Example ISP",
          city: "London",
          country: "UK",
          colo: "LHR"
        },
        endTime: 1700000000000
      };

      const summary = generateSummaryMarkdown(state);
      expect(summary).toContain("# Vicinae Speedtest Results");
      expect(summary).toContain("- **Status:** COMPLETE");
      expect(summary).toContain("- **Download:** 150.0 Mbps");
      expect(summary).toContain("- **Upload:** 45.0 Mbps");
      expect(summary).toContain("- **Ping (Avg):** 11.2 ms");
      expect(summary).toContain("- **Ping (Min):** 9.5 ms");
      expect(summary).toContain("- **Jitter:** 1.1 ms");
      expect(summary).toContain("- **ISP:** Example ISP");
      expect(summary).toContain("- **Datacenter:** LHR (London, UK)");
      expect(summary).toContain("- **Client IP:** 1.2.3.4");
    });

    it("handles missing values gracefully", () => {
      const state: SpeedtestState = {
        phase: "idle",
        progressPercent: 0
      };
      const summary = generateSummaryMarkdown(state);
      expect(summary).toContain("- **Status:** IDLE");
      expect(summary).toContain("- **Download:** N/A");
      expect(summary).toContain("- **Upload:** N/A");
      expect(summary).toContain("- **Ping (Avg):** N/A");
      expect(summary).toContain("- **ISP:** Unknown");
      expect(summary).toContain("- **Datacenter:** Unknown (Unknown)");
    });
  });

  describe("generateSummaryJson", () => {
    it("returns valid and structured JSON", () => {
      const state: SpeedtestState = {
        phase: "complete",
        progressPercent: 100,
        server: {
          ip: "1.1.1.1",
          colo: "SFO"
        },
        ping: {
          min: 10,
          avg: 12,
          jitter: 1,
          samples: [11, 13]
        },
        startTime: 1700000000000,
        endTime: 1700000010000
      };

      const jsonStr = generateSummaryJson(state);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.phase).toBe("complete");
      expect(parsed.progressPercent).toBe(100);
      expect(parsed.server.colo).toBe("SFO");
      expect(parsed.ping.avg).toBe(12);
      expect(parsed.startTime).toBe(1700000000000);
      expect(parsed.endTime).toBe(1700000010000);
      expect(parsed.error).toBeNull();
    });
  });
});
