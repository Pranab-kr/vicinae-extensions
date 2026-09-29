import { describe, it, expect } from "vitest";
import {
  formatSpeed,
  formatBytes,
  formatDuration,
  calculateJitter,
  renderGauge
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
});
