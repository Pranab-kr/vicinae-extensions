# Vicinae Speedtest Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight, local, real-time speed test extension for Vicinae using Cloudflare Edge endpoints without external CLI binaries.

**Architecture:** A native TypeScript extension using `@vicinae/api` to render a live `Detail` view. Network measurements stream directly against `speed.cloudflare.com` via Node.js native `fetch` streams with rolling-window throughput calculations for smooth real-time telemetry.

**Tech Stack:** TypeScript, React, `@vicinae/api`, Node.js `fetch` / `ReadableStream`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-vicinae-speedtest-design.md`

## Global Constraints
- Target platform: Linux (Vicinae launcher)
- Zero external binaries required (`speedtest`, Ookla binary, Python CLI, etc.)
- Zero persistent history files (ephemeral runs)
- Full cancellation support via `AbortController`
- Conforms to Vicinae extension manifest schema

---

### Task 1: Scaffolding, Manifest & Project Configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `assets/icon.svg`
- Create: `assets/icon.png`

**Interfaces:**
- Produces: Project build & test toolchain (`npm test`, `npm run build`).

- [ ] **Step 1: Create package.json manifest**

```json
{
  "$schema": "https://raw.githubusercontent.com/vicinaehq/vicinae/refs/heads/main/extra/schemas/extension.json",
  "name": "speedtest",
  "title": "Speedtest",
  "description": "Real-time network speed and latency test powered by Cloudflare Edge",
  "icon": "icon.png",
  "author": "pranab",
  "categories": ["System", "Developer Tools"],
  "license": "MIT",
  "commands": [
    {
      "name": "index",
      "title": "Speedtest",
      "subtitle": "Network Speed Test",
      "description": "Test internet speed and network latency in real time",
      "mode": "view",
      "icon": "icon.png"
    }
  ],
  "dependencies": {
    "@vicinae/api": "^0.20.15"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "@types/react": "19.0.10",
    "react": "19.0.0",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  },
  "scripts": {
    "build": "vici build -o dist",
    "dev": "vici develop",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Create tsconfig.json and vitest.config.ts**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowJs": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node"
  }
});
```

- [ ] **Step 3: Create asset icons (SVG and PNG)**

Create `assets/icon.svg`:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#3b82f6" />
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="#0f172a"/>
  <path d="M64 24 A 40 40 0 1 0 100 80" fill="none" stroke="#334155" stroke-width="10" stroke-linecap="round"/>
  <path d="M64 24 A 40 40 0 0 1 96 48" fill="none" stroke="url(#grad)" stroke-width="10" stroke-linecap="round"/>
  <circle cx="64" cy="64" r="8" fill="#38bdf8"/>
  <line x1="64" y1="64" x2="88" y2="40" stroke="#38bdf8" stroke-width="6" stroke-linecap="round"/>
</svg>
```
Convert or generate 128x128 `assets/icon.png`.

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules` installed successfully without error.

- [ ] **Step 5: Verify toolchain works**

Run: `npx vitest --version`
Expected: Prints Vitest version (e.g. 3.x).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts assets/
git commit -m "chore: scaffold vicinae speedtest extension and dependencies"
```

---

### Task 2: Core Types & Mathematical Utilities (TDD)

**Files:**
- Create: `src/engine/types.ts`
- Create: `src/engine/utils.ts`
- Test: `tests/utils.test.ts`

**Interfaces:**
- Consumes: Node standard libraries.
- Produces:
  - `SpeedtestPhase`, `ServerMetadata`, `PingResult`, `SpeedResult`, `SpeedtestState` types
  - `formatSpeed(mbps: number): string`
  - `formatBytes(bytes: number): string`
  - `formatDuration(ms: number): string`
  - `calculateJitter(samples: number[]): number`
  - `renderGauge(current: number, max: number, width?: number): string`

- [ ] **Step 1: Write failing test in `tests/utils.test.ts`**

```ts
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
    expect(calculateJitter([10, 14, 12, 16])).toBeCloseTo(3.0, 1);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils.test.ts`
Expected: FAIL (Cannot find module `../src/engine/utils`)

- [ ] **Step 3: Implement `src/engine/types.ts` and `src/engine/utils.ts`**

`src/engine/types.ts`:
```ts
export type SpeedtestPhase =
  | "idle"
  | "discovering"
  | "ping"
  | "download"
  | "upload"
  | "complete"
  | "error"
  | "aborted";

export interface ServerMetadata {
  ip: string;
  asn?: number;
  isp?: string;
  city?: string;
  country?: string;
  colo?: string;
}

export interface PingResult {
  min: number;
  avg: number;
  jitter: number;
  samples: number[];
}

export interface SpeedResult {
  currentSpeedMbps: number;
  averageSpeedMbps: number;
  bytesTransferred: number;
  durationMs: number;
}

export interface SpeedtestState {
  phase: SpeedtestPhase;
  progressPercent: number;
  server?: ServerMetadata;
  ping?: PingResult;
  currentPing?: number;
  download?: SpeedResult;
  upload?: SpeedResult;
  error?: string;
  startTime?: number;
  endTime?: number;
}
```

`src/engine/utils.ts`:
```ts
export function formatSpeed(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return "0.0 Mbps";
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(2)} Gbps`;
  }
  return `${mbps.toFixed(1)} Mbps`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unitIndex = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function calculateJitter(samples: number[]): number {
  if (samples.length < 2) return 0;
  let totalDiff = 0;
  for (let i = 1; i < samples.length; i++) {
    totalDiff += Math.abs(samples[i] - samples[i - 1]);
  }
  return totalDiff / (samples.length - 1);
}

export function renderGauge(current: number, max: number, width: number = 16): string {
  const clamped = Math.max(0, Math.min(current, max));
  const ratio = max > 0 ? clamped / max : 0;
  const filledCount = Math.round(ratio * width);
  const emptyCount = Math.max(0, width - filledCount);
  return `[${"█".repeat(filledCount)}${"░".repeat(emptyCount)}]`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/utils.ts tests/utils.test.ts
git commit -m "feat: add types and formatting utilities with tests"
```

---

### Task 3: Cloudflare Speed Test Engine (TDD)

**Files:**
- Create: `src/engine/cloudflare.ts`
- Test: `tests/cloudflare.test.ts`

**Interfaces:**
- Consumes: `src/engine/types.ts`, `src/engine/utils.ts`.
- Produces:
  - `runSpeedtest(onUpdate: (state: SpeedtestState) => void, signal?: AbortSignal): Promise<SpeedtestState>`
  - `discoverMetadata(signal?: AbortSignal): Promise<ServerMetadata>`
  - `measureLatency(onProgress: (p: number, current: number) => void, signal?: AbortSignal): Promise<PingResult>`
  - `measureDownload(onProgress: (res: SpeedResult) => void, signal?: AbortSignal): Promise<SpeedResult>`
  - `measureUpload(onProgress: (res: SpeedResult) => void, signal?: AbortSignal): Promise<SpeedResult>`

- [ ] **Step 1: Write failing test in `tests/cloudflare.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverMetadata, measureLatency } from "../src/engine/cloudflare";

describe("cloudflare engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses server metadata from /meta correctly", async () => {
    const mockMeta = {
      clientIp: "1.2.3.4",
      asn: 13335,
      asOrganization: "Cloudflare, Inc.",
      city: "San Francisco",
      country: "US",
      colo: "SFO"
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockMeta
    } as any);

    const meta = await discoverMetadata();
    expect(meta.ip).toBe("1.2.3.4");
    expect(meta.isp).toBe("Cloudflare, Inc.");
    expect(meta.colo).toBe("SFO");
  });

  it("handles abort signals during latency measurement", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(measureLatency(() => {}, controller.signal)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cloudflare.test.ts`
Expected: FAIL (Cannot find module `../src/engine/cloudflare`)

- [ ] **Step 3: Implement `src/engine/cloudflare.ts`**

Implement:
- `discoverMetadata(signal)`: calls `https://speed.cloudflare.com/meta`
- `measureLatency(onProgress, signal)`: 8 probes to `https://speed.cloudflare.com/__down?bytes=0`
- `measureDownload(onProgress, signal)`: multi-chunk GET requests (`/__down?bytes=25000000`) with chunk byte accounting and rolling window
- `measureUpload(onProgress, signal)`: streaming POST chunks to `/__up`
- `runSpeedtest(onUpdate, signal)`: orchestrates the 4 stages, maintaining state progression

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cloudflare.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/cloudflare.ts tests/cloudflare.test.ts
git commit -m "feat: implement cloudflare speed test streaming engine with tests"
```

---

### Task 4: React Hook & Detail View Component

**Files:**
- Create: `src/hooks/useSpeedtest.ts`
- Create: `src/index.tsx`

**Interfaces:**
- Consumes: `src/engine/cloudflare.ts`, `src/engine/types.ts`, `src/engine/utils.ts`, `@vicinae/api`.
- Produces: Main command React view component.

- [ ] **Step 1: Implement `src/hooks/useSpeedtest.ts`**

Encapsulates:
- `state`: `SpeedtestState`
- `isTesting`: boolean
- `startTest()`: creates `AbortController`, calls `runSpeedtest`, handles errors & cleanup
- `cancelTest()`: aborts current controller
- `resetTest()`: resets state to idle
- `useEffect` hook: auto-starts test on first mount, aborts on unmount

- [ ] **Step 2: Implement `src/index.tsx`**

Renders:
- Markdown content:
  - Header with phase icon and title
  - Dynamic progress bar
  - Live metric bullet points: Download, Upload, Ping, Jitter
  - Server & ISP connection table
- `Detail.Metadata`:
  - Phase status tag (with color)
  - Ping label & jitter
  - Download & Upload labels
  - Server colo & Client IP
- `ActionPanel`:
  - `Action title="Restart Test" icon={Icon.ArrowClockwise} onAction={startTest}`
  - `Action.CopyToClipboard title="Copy Results as Markdown" content={summaryMarkdown}`
  - `Action.CopyToClipboard title="Copy Results as JSON" content={summaryJson}`
  - `Action title="Cancel Test" icon={Icon.XMarkCircle} onAction={cancelTest}` (when running)

- [ ] **Step 3: Run Vitest across all tests**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSpeedtest.ts src/index.tsx
git commit -m "feat: add useSpeedtest hook and interactive Detail view"
```

---

### Task 5: Build, Bundle Verification & Vicinae Local Registration

**Files:**
- Output: `dist/index.js`, `dist/package.json`

- [ ] **Step 1: Run `npm run build`**

Run: `npm run build`
Expected: `vici build -o dist` compiles the TypeScript codebase into `dist/`.

- [ ] **Step 2: Verify compiled artifacts**

Check `dist/` contains valid JavaScript and assets.
Run: `ls -la dist`

- [ ] **Step 3: Register / Symlink extension to Vicinae extensions directory**

Link or copy the built extension to `~/.local/share/vicinae/extensions/speedtest`:
```bash
ln -sfn /home/pranab/play/speedtest /home/pranab/.local/share/vicinae/extensions/speedtest
```
or run `vici build` without `-o` so it registers directly in Vicinae.

- [ ] **Step 4: Verify extension detection in Vicinae**

Check `vicinae state` or query Vicinae to verify the extension is recognized.

- [ ] **Step 5: Final Git commit**

```bash
git add .
git commit -m "feat: complete vicinae speedtest extension build and registration"
```
