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

  it("renders ASCII gauge bars correctly", () => {
    const empty = renderGauge(0, 100, 10);
    expect(empty).toBe("[░░░░░░░░░░]");
    const half = renderGauge(50, 100, 10);
    expect(half).toBe("[█████░░░░░]");
    const full = renderGauge(100, 100, 10);
    expect(full).toBe("[██████████]");
  });
});
