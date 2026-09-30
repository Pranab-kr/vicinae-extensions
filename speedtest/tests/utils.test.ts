import { describe, it, expect } from "vitest";
import {
  formatSpeed,
  formatBytes,
  formatDuration,
  calculateJitter,
  renderGauge,
  calculateWindowSpeed
} from "../src/engine/utils";

describe("utils", () => {
  it("formats speed values accurately", () => {
    expect(formatSpeed(0)).toBe("0.0 Mbps");
    expect(formatSpeed(45.678)).toBe("45.7 Mbps");
    expect(formatSpeed(1250)).toBe("1.25 Gbps");
  });

  it("formats byte values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1048576 * 5)).toBe("5.0 MB");
  });

  it("formats durations", () => {
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(3500)).toBe("3.5s");
  });

  it("calculates jitter as mean difference of consecutive samples", () => {
    expect(calculateJitter([])).toBe(0);
    expect(calculateJitter([10])).toBe(0);
    expect(calculateJitter([10, 14, 12, 16])).toBeCloseTo(3.33, 1);
  });

  describe("renderGauge", () => {
    it("renders ASCII gauge bars correctly for normal values", () => {
      const empty = renderGauge(0, 100, 10);
      expect(empty).toBe("[░░░░░░░░░░]");
      const half = renderGauge(50, 100, 10);
      expect(half).toBe("[█████░░░░░]");
      const full = renderGauge(100, 100, 10);
      expect(full).toBe("[██████████]");
      const overflow = renderGauge(150, 100, 10);
      expect(overflow).toBe("[██████████]");
    });

    it("handles negative numbers safely without throwing", () => {
      expect(renderGauge(-10, 100, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(-50, -100, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(50, -100, 10)).toBe("[░░░░░░░░░░]");
    });

    it("handles max <= 0 gracefully", () => {
      expect(renderGauge(50, 0, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(0, 0, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(-5, 0, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(50, -10, 10)).toBe("[░░░░░░░░░░]");
    });

    it("handles NaN inputs safely", () => {
      expect(renderGauge(NaN, 100, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(50, NaN, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(NaN, NaN, 10)).toBe("[░░░░░░░░░░]");
    });

    it("handles non-finite inputs safely", () => {
      expect(renderGauge(Infinity, 100, 10)).toBe("[██████████]");
      expect(renderGauge(-Infinity, 100, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(50, Infinity, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(Infinity, Infinity, 10)).toBe("[░░░░░░░░░░]");
      expect(renderGauge(-Infinity, -Infinity, 10)).toBe("[░░░░░░░░░░]");
    });

    it("handles custom or invalid width safely", () => {
      expect(renderGauge(50, 100, 0)).toHaveLength(18); // default width 16 + brackets
      expect(renderGauge(50, 100, -5)).toHaveLength(18);
      expect(renderGauge(50, 100, NaN)).toHaveLength(18);
    });
  });

  describe("calculateWindowSpeed", () => {
    it("returns 0 when totalBytes is 0 or negative", () => {
      expect(calculateWindowSpeed([], 1000, 0, 0)).toBe(0);
      expect(calculateWindowSpeed([], 1000, 0, -100)).toBe(0);
    });

    it("calculates initial speed before window cutoff is reached", () => {
      const samples = [{ timestamp: 0, totalBytes: 0 }];
      // 500 KB (4,000,000 bits) in 500ms = 8 Mbps
      const speed = calculateWindowSpeed(samples, 500, 0, 500000, 1200);
      expect(speed).toBeCloseTo(8.0, 1);
    });

    it("slides window and calculates speed based on window duration", () => {
      const samples = [
        { timestamp: 0, totalBytes: 0 },
        { timestamp: 500, totalBytes: 1000000 },
        { timestamp: 1000, totalBytes: 2000000 },
        { timestamp: 1500, totalBytes: 3000000 }
      ];

      // At now = 2000 with 1200ms window (cutoff = 800ms):
      // sample at t=0 and t=500 are older than cutoff.
      // Base sample kept will be at t=500 (latest sample <= 800).
      // dt = 2000 - 500 = 1500ms, db = 4,000,000 - 1,000,000 = 3,000,000 bytes (24,000,000 bits).
      // Speed = 24 / 1.5 = 16.0 Mbps.
      const speed = calculateWindowSpeed(samples, 2000, 0, 4000000, 1200);
      expect(speed).toBeCloseTo(16.0, 1);
    });

    it("stabilizes burst completions across concurrent streams", () => {
      const samples = [
        { timestamp: 0, totalBytes: 0 },
        { timestamp: 1000, totalBytes: 3125000 } // ~25 Mbps at 1s
      ];

      // Two chunks complete within 10ms of each other at t=1200ms
      // Adding 1 MB (8,000,000 bits) in just 10ms would naively spike to 800 Mbps,
      // but calculateWindowSpeed measures over the ~1200ms window baseline.
      samples.push({ timestamp: 1200, totalBytes: 3750000 });
      const speed = calculateWindowSpeed(samples, 1200, 0, 3750000, 1200);

      // (3,750,000 bytes * 8) / (1200ms * 1000) = 25.0 Mbps!
      expect(speed).toBeCloseTo(25.0, 0.5);
    });
  });
});

