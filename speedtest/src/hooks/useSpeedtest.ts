import { useState, useRef, useEffect, useCallback } from "react";
import { runSpeedtest } from "../engine/cloudflare";
import type { SpeedtestState } from "../engine/types";

export interface UseSpeedtestOptions {
  autoStart?: boolean;
}

export interface UseSpeedtestReturn {
  state: SpeedtestState;
  isTesting: boolean;
  error?: string;
  startTest: () => Promise<void>;
  cancelTest: () => void;
  resetTest: () => void;
  start: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export const INITIAL_SPEEDTEST_STATE: SpeedtestState = {
  phase: "idle",
  progressPercent: 0
};

export function useSpeedtest(options: UseSpeedtestOptions = {}): UseSpeedtestReturn {
  const { autoStart = true } = options;

  const [state, setState] = useState<SpeedtestState>(INITIAL_SPEEDTEST_STATE);
  const [isTesting, setIsTesting] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const cancelTest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      if (isMountedRef.current) {
        setIsTesting(false);
        setState((prev) => ({
          ...prev,
          phase: "aborted",
          error: "Speedtest cancelled",
          endTime: Date.now()
        }));
      }
    }
  }, []);

  const resetTest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (isMountedRef.current) {
      setIsTesting(false);
      setState(INITIAL_SPEEDTEST_STATE);
    }
  }, []);

  const startTest = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (isMountedRef.current) {
      setIsTesting(true);
      setState({
        phase: "discovering",
        progressPercent: 0,
        startTime: Date.now()
      });
    }

    try {
      await runSpeedtest((newState) => {
        if (isMountedRef.current && abortControllerRef.current === controller) {
          setState(newState);
        }
      }, controller.signal);
    } catch {
      // runSpeedtest handles setting error/aborted state via onUpdate callback
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        if (isMountedRef.current) {
          setIsTesting(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (autoStart) {
      startTest();
    }
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [autoStart, startTest]);

  return {
    state,
    isTesting,
    error: state.error,
    startTest,
    cancelTest,
    resetTest,
    start: startTest,
    cancel: cancelTest,
    reset: resetTest
  };
}
