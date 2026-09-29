import "./setup";
import { describe, it, expect, vi } from "vitest";
import { INITIAL_SPEEDTEST_STATE, useSpeedtest } from "../src/hooks/useSpeedtest";

describe("useSpeedtest", () => {
  it("exports useSpeedtest function and initial state", () => {
    expect(typeof useSpeedtest).toBe("function");
    expect(INITIAL_SPEEDTEST_STATE).toEqual({
      phase: "idle",
      progressPercent: 0
    });
  });
});
