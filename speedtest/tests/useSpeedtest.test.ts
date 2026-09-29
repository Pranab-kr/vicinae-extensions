import "./setup";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpeedtestState } from "../src/engine/types";

// Harness for running React hooks in node test environment
let currentHarness: HookHarness | null = null;

class HookHarness {
  hookIndex = 0;
  slots: any[] = [];
  isMounted = true;
  result: any = null;
  hookFn: () => any;

  constructor(hookFn: () => any) {
    this.hookFn = hookFn;
  }

  render() {
    if (!this.isMounted) return;
    this.hookIndex = 0;
    currentHarness = this;
    try {
      this.result = this.hookFn();
    } finally {
      currentHarness = null;
    }
    this.runEffects();
  }

  runEffects() {
    for (const slot of this.slots) {
      if (slot?.type === "effect" && slot.shouldRun) {
        slot.shouldRun = false;
        if (typeof slot.cleanup === "function") {
          try {
            slot.cleanup();
          } catch (e) {
            console.error(e);
          }
          slot.cleanup = undefined;
        }
        slot.cleanup = slot.effect();
      }
    }
  }

  unmount() {
    this.isMounted = false;
    for (const slot of this.slots) {
      if (slot?.type === "effect" && typeof slot.cleanup === "function") {
        slot.cleanup();
        slot.cleanup = undefined;
      }
    }
  }
}

vi.mock("react", () => {
  return {
    useState: (initial: any) => {
      if (!currentHarness) throw new Error("useState called outside renderHook");
      const harness = currentHarness;
      const idx = harness.hookIndex++;
      if (!harness.slots[idx]) {
        const val = typeof initial === "function" ? initial() : initial;
        harness.slots[idx] = {
          type: "state",
          value: val,
          setter: (updater: any) => {
            const prev = harness.slots[idx].value;
            const next = typeof updater === "function" ? updater(prev) : updater;
            if (next !== prev) {
              harness.slots[idx].value = next;
              harness.render();
            }
          }
        };
      }
      return [harness.slots[idx].value, harness.slots[idx].setter];
    },

    useRef: (initial: any) => {
      if (!currentHarness) throw new Error("useRef called outside renderHook");
      const harness = currentHarness;
      const idx = harness.hookIndex++;
      if (!harness.slots[idx]) {
        harness.slots[idx] = {
          type: "ref",
          ref: { current: initial }
        };
      }
      return harness.slots[idx].ref;
    },

    useCallback: (callback: any, deps: any[]) => {
      if (!currentHarness) throw new Error("useCallback called outside renderHook");
      const harness = currentHarness;
      const idx = harness.hookIndex++;
      const slot = harness.slots[idx];
      if (!slot) {
        harness.slots[idx] = { type: "callback", callback, deps };
        return callback;
      }
      const changed = !deps || !slot.deps || deps.some((d, i) => !Object.is(d, slot.deps[i]));
      if (changed) {
        slot.callback = callback;
        slot.deps = deps;
      }
      return slot.callback;
    },

    useEffect: (effect: any, deps?: any[]) => {
      if (!currentHarness) throw new Error("useEffect called outside renderHook");
      const harness = currentHarness;
      const idx = harness.hookIndex++;
      const slot = harness.slots[idx];
      if (!slot) {
        harness.slots[idx] = {
          type: "effect",
          effect,
          deps,
          cleanup: undefined,
          shouldRun: true
        };
        return;
      }
      const changed = !deps || !slot.deps || deps.some((d, i) => !Object.is(d, slot.deps[i]));
      if (changed) {
        slot.effect = effect;
        slot.deps = deps;
        slot.shouldRun = true;
      }
    }
  };
});

vi.mock("../src/engine/cloudflare", () => ({
  runSpeedtest: vi.fn()
}));

import { INITIAL_SPEEDTEST_STATE, useSpeedtest } from "../src/hooks/useSpeedtest";
import { runSpeedtest } from "../src/engine/cloudflare";

function renderHook<T>(hookFn: () => T) {
  const harness = new HookHarness(hookFn);
  harness.render();
  return {
    result: {
      get current() {
        return harness.result;
      }
    },
    rerender: () => harness.render(),
    unmount: () => harness.unmount()
  };
}

describe("useSpeedtest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exports useSpeedtest function and initial state", () => {
    expect(typeof useSpeedtest).toBe("function");
    expect(INITIAL_SPEEDTEST_STATE).toEqual({
      phase: "idle",
      progressPercent: 0
    });
  });

  it("initializes with idle state and alias methods when autoStart is false", () => {
    const { result } = renderHook(() => useSpeedtest({ autoStart: false }));

    expect(result.current.state).toEqual(INITIAL_SPEEDTEST_STATE);
    expect(result.current.isTesting).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.start).toBe(result.current.startTest);
    expect(result.current.cancel).toBe(result.current.cancelTest);
    expect(result.current.reset).toBe(result.current.resetTest);
  });

  it("startTest() transitions phase from discovering -> ping -> download -> upload -> complete", async () => {
    let updateCallback: ((state: SpeedtestState) => void) | null = null;
    let completeResolve: (val: SpeedtestState) => void;
    const testRunningPromise = new Promise<SpeedtestState>((resolve) => {
      completeResolve = resolve;
    });

    vi.mocked(runSpeedtest).mockImplementation(async (onUpdate, signal) => {
      updateCallback = onUpdate;
      return testRunningPromise;
    });

    const { result } = renderHook(() => useSpeedtest({ autoStart: false }));

    expect(result.current.state.phase).toBe("idle");
    expect(result.current.isTesting).toBe(false);

    const testPromise = result.current.startTest();

    // Stage 1: discovering
    expect(result.current.isTesting).toBe(true);
    expect(result.current.state.phase).toBe("discovering");
    expect(result.current.state.progressPercent).toBe(0);

    // Stage 2: ping
    updateCallback!({ phase: "ping", progressPercent: 20 });
    expect(result.current.state.phase).toBe("ping");
    expect(result.current.state.progressPercent).toBe(20);

    // Stage 3: download
    updateCallback!({
      phase: "download",
      progressPercent: 50,
      download: { currentSpeedMbps: 120, averageSpeedMbps: 110, bytesTransferred: 12500000, durationMs: 900 }
    });
    expect(result.current.state.phase).toBe("download");
    expect(result.current.state.progressPercent).toBe(50);

    // Stage 4: upload
    updateCallback!({
      phase: "upload",
      progressPercent: 80,
      upload: { currentSpeedMbps: 45, averageSpeedMbps: 40, bytesTransferred: 10000000, durationMs: 2000 }
    });
    expect(result.current.state.phase).toBe("upload");
    expect(result.current.state.progressPercent).toBe(80);

    // Stage 5: complete
    const finalState: SpeedtestState = {
      phase: "complete",
      progressPercent: 100,
      server: { ip: "1.1.1.1", isp: "Cloudflare", colo: "SFO", city: "San Francisco", country: "US" },
      ping: { min: 10, avg: 12, jitter: 1, samples: [10, 14] },
      download: { currentSpeedMbps: 120, averageSpeedMbps: 110, bytesTransferred: 12500000, durationMs: 900 },
      upload: { currentSpeedMbps: 45, averageSpeedMbps: 40, bytesTransferred: 10000000, durationMs: 2000 },
      endTime: Date.now()
    };
    updateCallback!(finalState);
    expect(result.current.state.phase).toBe("complete");
    expect(result.current.state.progressPercent).toBe(100);

    completeResolve!(finalState);
    await testPromise;

    expect(result.current.state.phase).toBe("complete");
    expect(result.current.isTesting).toBe(false);
    expect(result.current.state.server?.colo).toBe("SFO");
    expect(result.current.error).toBeUndefined();
    expect(vi.mocked(runSpeedtest)).toHaveBeenCalledTimes(1);
  });

  it("cancelTest() properly sets state and aborts active test", async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(runSpeedtest).mockImplementation(async (onUpdate, signal) => {
      receivedSignal = signal;
      onUpdate({ phase: "ping", progressPercent: 15 });
      return new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new Error("Speedtest cancelled"));
        });
      });
    });

    const { result } = renderHook(() => useSpeedtest({ autoStart: false }));

    const testPromise = result.current.startTest();
    expect(result.current.isTesting).toBe(true);
    expect(result.current.state.phase).toBe("ping");
    expect(receivedSignal?.aborted).toBe(false);

    result.current.cancelTest();

    expect(receivedSignal?.aborted).toBe(true);
    expect(result.current.state.phase).toBe("aborted");
    expect(result.current.state.error).toBe("Speedtest cancelled");
    expect(result.current.error).toBe("Speedtest cancelled");
    expect(result.current.isTesting).toBe(false);

    await testPromise;
    expect(result.current.state.phase).toBe("aborted");
    expect(result.current.isTesting).toBe(false);
  });

  it("cancelTest() is a safe no-op when test is not running", () => {
    const { result } = renderHook(() => useSpeedtest({ autoStart: false }));
    expect(() => result.current.cancelTest()).not.toThrow();
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.isTesting).toBe(false);
  });

  it("resetTest() restores initial state and aborts running test", async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(runSpeedtest).mockImplementation(async (onUpdate, signal) => {
      receivedSignal = signal;
      onUpdate({ phase: "download", progressPercent: 40 });
      return new Promise(() => {});
    });

    const { result } = renderHook(() => useSpeedtest({ autoStart: false }));

    result.current.startTest();
    expect(result.current.state.phase).toBe("download");
    expect(result.current.isTesting).toBe(true);

    result.current.resetTest();

    expect(receivedSignal?.aborted).toBe(true);
    expect(result.current.state).toEqual(INITIAL_SPEEDTEST_STATE);
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.progressPercent).toBe(0);
    expect(result.current.isTesting).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("resetTest() resets completed test back to idle state", async () => {
    const finalState: SpeedtestState = {
      phase: "complete",
      progressPercent: 100,
      endTime: Date.now()
    };
    vi.mocked(runSpeedtest).mockImplementation(async (onUpdate) => {
      onUpdate(finalState);
      return finalState;
    });

    const { result } = renderHook(() => useSpeedtest({ autoStart: false }));
    await result.current.startTest();

    expect(result.current.state.phase).toBe("complete");

    result.current.resetTest();
    expect(result.current.state).toEqual(INITIAL_SPEEDTEST_STATE);
    expect(result.current.isTesting).toBe(false);
  });

  it("handles error when runSpeedtest throws with error state", async () => {
    vi.mocked(runSpeedtest).mockImplementation(async (onUpdate) => {
      const errorState: SpeedtestState = {
        phase: "error",
        progressPercent: 25,
        error: "Network connection refused"
      };
      onUpdate(errorState);
      throw new Error("Network connection refused");
    });

    const { result } = renderHook(() => useSpeedtest({ autoStart: false }));

    await expect(result.current.startTest()).resolves.toBeUndefined();

    expect(result.current.state.phase).toBe("error");
    expect(result.current.state.error).toBe("Network connection refused");
    expect(result.current.error).toBe("Network connection refused");
    expect(result.current.isTesting).toBe(false);
  });

  it("handles unexpected thrown error gracefully without crashing", async () => {
    vi.mocked(runSpeedtest).mockRejectedValueOnce(new Error("Unexpected internal crash"));

    const { result } = renderHook(() => useSpeedtest({ autoStart: false }));

    await expect(result.current.startTest()).resolves.toBeUndefined();
    expect(result.current.isTesting).toBe(false);
  });

  it("autoStart: true triggers test automatically on mount", async () => {
    vi.mocked(runSpeedtest).mockImplementation(async (onUpdate) => {
      onUpdate({ phase: "complete", progressPercent: 100 });
      return { phase: "complete", progressPercent: 100 };
    });

    const { result } = renderHook(() => useSpeedtest({ autoStart: true }));

    // Upon mounting, startTest was kicked off
    expect(vi.mocked(runSpeedtest)).toHaveBeenCalledTimes(1);
  });

  it("unmount aborts any active running test", () => {
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(runSpeedtest).mockImplementation(async (_onUpdate, signal) => {
      receivedSignal = signal;
      return new Promise(() => {});
    });

    const harness = renderHook(() => useSpeedtest({ autoStart: true }));
    expect(receivedSignal?.aborted).toBe(false);

    harness.unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("starting a second test aborts the previous active test", async () => {
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;
    let invocationCount = 0;

    vi.mocked(runSpeedtest).mockImplementation(async (_onUpdate, signal) => {
      invocationCount++;
      if (invocationCount === 1) {
        firstSignal = signal;
      } else {
        secondSignal = signal;
      }
      return new Promise(() => {});
    });

    const { result } = renderHook(() => useSpeedtest({ autoStart: false }));

    result.current.startTest();
    expect(firstSignal?.aborted).toBe(false);

    result.current.startTest();
    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);
  });
});
