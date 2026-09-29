# AI Agent Vicinae Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, personal AI agent extension for the Vicinae desktop launcher featuring multi-provider streaming chat (OpenRouter, Google Gemini, OpenAI, and Ollama) with real-time web search/fetch, an SSRF-safe tool loop, and a keyboard-first `<List isShowingDetail />` UI.

**Architecture:** A decoupled TypeScript architecture with an isolated engine layer (`engine/`) handling SSE stream decoding, SSRF-guarded web tools, and provider adapters (OpenRouter server-side tools, Gemini Search Grounding, and OpenAI tool delta accumulator), persisted via `@vicinae/api` `LocalStorage`, and rendered natively in Vicinae through `<List isShowingDetail />`.

**Tech Stack:** Node.js, TypeScript, React 19, `@vicinae/api`, `vici` CLI compiler, and Vitest for unit testing.

**Spec:** [docs/superpowers/specs/2026-09-29-ai-agent-vicinae-extension-design.md](file:///home/pranab/play/vici/docs/superpowers/specs/2026-09-29-ai-agent-vicinae-extension-design.md)

## Global Constraints

- Root project directory: `/home/pranab/play/vici/ai-agent`.
- Local installation destination: `~/.local/share/vicinae/extensions/ai-agent`.
- API keys must only be read from explicit extension preferences; do not check or fallback to `process.env`.
- Gemini API key must be sent in `x-goog-api-key` HTTP header, never in the URL query string.
- All web fetching from the client must be SSRF-protected (blocking loopback, private RFC1918, link-local, and cloud metadata IPs).
- Vicinae chat UI must use `<List isShowingDetail filtering={false} searchText={...}>` because `<Detail>` has no search bar in `@vicinae/api`.
- Streaming updates to React state must be throttled to 60–80ms intervals to prevent UI lag.
- Disk storage writes must only occur after stream completion, never on individual token chunks.

---

### Task 1: Extension Scaffolding, Package Manifest & Assets

**Files:**
- Create: `ai-agent/package.json`
- Create: `ai-agent/tsconfig.json`
- Create: `ai-agent/vitest.config.ts`
- Create: `ai-agent/assets/icon.png`
- Create: `ai-agent/assets/web-search.png`

**Interfaces:**
- Produces: Project build configuration, dependency definitions, and Vicinae extension manifest declaring `ask` and `conversations` commands and preferences schema.

- [ ] **Step 1: Create project directory and package.json**

Create `ai-agent/package.json` specifying `@vicinae/api` dependency, build scripts, preferences schema, and commands:

```json
{
  "name": "ai-agent",
  "title": "AI Agent",
  "description": "Chat with AI agents powered by OpenRouter, Gemini, and OpenAI with real-time web search",
  "icon": "icon.png",
  "author": "pranab",
  "categories": ["Productivity", "Developer Tools"],
  "license": "MIT",
  "commands": [
    {
      "name": "ask",
      "title": "Chat with AI Agent",
      "subtitle": "AI Agent",
      "description": "Ask questions and chat with real-time web search",
      "mode": "view",
      "icon": "icon.png"
    },
    {
      "name": "conversations",
      "title": "AI Agent Conversations",
      "subtitle": "AI Agent",
      "description": "Browse and resume previous chat conversations",
      "mode": "view",
      "icon": "icon.png"
    }
  ],
  "preferences": [
    {
      "name": "provider",
      "title": "AI Provider",
      "description": "Select the AI backend to use",
      "type": "dropdown",
      "required": true,
      "default": "openrouter",
      "data": [
        { "title": "OpenRouter", "value": "openrouter" },
        { "title": "Google Gemini", "value": "gemini" },
        { "title": "OpenAI", "value": "openai" },
        { "title": "Ollama / Custom Endpoint", "value": "ollama_custom" }
      ]
    },
    {
      "name": "modelId",
      "title": "Model ID",
      "description": "Enter the exact model identifier to call",
      "type": "textfield",
      "required": true,
      "default": "anthropic/claude-3.7-sonnet"
    },
    {
      "name": "openrouterApiKey",
      "title": "OpenRouter API Key",
      "description": "Your OpenRouter API Key (sk-or-v1-...)",
      "type": "password",
      "required": false
    },
    {
      "name": "geminiApiKey",
      "title": "Google Gemini API Key",
      "description": "Your Google AI Studio API Key (AIzaSy...)",
      "type": "password",
      "required": false
    },
    {
      "name": "openaiApiKey",
      "title": "OpenAI API Key",
      "description": "Your OpenAI API Key (sk-proj-...)",
      "type": "password",
      "required": false
    },
    {
      "name": "customBaseUrl",
      "title": "Custom Base URL",
      "description": "Base URL for Ollama / LocalAI / OpenAI-compatible endpoint",
      "type": "textfield",
      "required": false,
      "default": "http://localhost:11434/v1"
    },
    {
      "name": "enableWebSearch",
      "title": "Web Search & Fetch",
      "label": "Enable real-time web search and page reading",
      "description": "Enables live web browsing for up-to-date information",
      "type": "checkbox",
      "required": true,
      "default": true
    },
    {
      "name": "systemPrompt",
      "title": "System Prompt",
      "description": "Instructions defining the agent's behavior and tone",
      "type": "textfield",
      "required": false,
      "default": "You are a helpful AI assistant with real-time web access. Format responses cleanly in markdown."
    }
  ],
  "dependencies": {
    "@vicinae/api": "^0.20.8"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "@types/react": "19.0.10",
    "react": "19.0.0",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  },
  "scripts": {
    "build": "vici build",
    "dev": "vici develop",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Create tsconfig.json and vitest.config.ts**

Create `ai-agent/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

Create `ai-agent/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: Create assets and icons**

Generate minimal placeholder PNG icons for `ai-agent/assets/icon.png` and `ai-agent/assets/web-search.png` using Node base64 buffer write.

- [ ] **Step 4: Install dependencies and verify build tool**

Run:
```bash
cd /home/pranab/play/vici/ai-agent && npm install
```
Verify `node_modules` exists.

- [ ] **Step 5: Commit scaffolding**

```bash
git add ai-agent
git commit -m "chore: scaffold ai-agent extension project"
```

---

### Task 2: Core Types & Lightweight SSE Stream Decoder

**Files:**
- Create: `ai-agent/src/types.ts`
- Create: `ai-agent/src/engine/sse.ts`
- Test: `ai-agent/src/engine/__tests__/sse.test.ts`

**Interfaces:**
- Produces: `Message`, `Conversation`, `StreamEvent`, `SSEStreamDecoder`
- Consumes: Native Node / browser `ReadableStream<Uint8Array>` or `AsyncIterable<Uint8Array>`

- [ ] **Step 1: Define core shared types**

Write `ai-agent/src/types.ts`:
```ts
export type Role = "user" | "assistant" | "system";

export interface Citation {
  title: string;
  url: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  reasoning?: string;
  citations?: Citation[];
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  provider: "openrouter" | "gemini" | "openai" | "ollama_custom";
  modelId: string;
  enableWebSearch: boolean;
  systemPrompt: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Preferences {
  provider: "openrouter" | "gemini" | "openai" | "ollama_custom";
  modelId: string;
  openrouterApiKey?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  customBaseUrl?: string;
  enableWebSearch: boolean;
  systemPrompt?: string;
}

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "status"; message: string }
  | { type: "citation"; citation: Citation }
  | { type: "error"; error: string }
  | { type: "done" };
```

- [ ] **Step 2: Write failing unit test for SSE parser**

Write `ai-agent/src/engine/__tests__/sse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseSSEStream } from "../sse.js";

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("parseSSEStream", () => {
  it("ignores comment lines starting with colon like OpenRouter processing", async () => {
    const raw = [
      ": OPENROUTER PROCESSING\n\n",
      "data: {\"text\": \"hello\"}\n\n",
      ": another comment\n",
      "data: {\"text\": \" world\"}\n\n",
      "data: [DONE]\n\n",
    ];
    const stream = createMockStream(raw);
    const events: any[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }
    expect(events).toEqual([{ text: "hello" }, { text: " world" }]);
  });

  it("handles multi-line chunks and incomplete frames across chunks", async () => {
    const raw = [
      "data: {\"te",
      "xt\": \"part1\"}\n\ndata: {\"te",
      "xt\": \"part2\"}\n\n",
    ];
    const stream = createMockStream(raw);
    const events: any[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }
    expect(events).toEqual([{ text: "part1" }, { text: "part2" }]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run ai-agent/src/engine/__tests__/sse.test.ts`
Expected: FAIL (cannot find module `../sse.js`).

- [ ] **Step 4: Implement parseSSEStream**

Write `ai-agent/src/engine/sse.ts`:
```ts
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<any, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) {
          // SSE comment or keepalive (e.g. : OPENROUTER PROCESSING)
          continue;
        }

        if (trimmed.startsWith("data:")) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            return;
          }
          try {
            const parsed = JSON.parse(dataStr);
            yield parsed;
          } catch {
            // Incomplete or non-JSON frame, skip or let next chunk assemble
          }
        }
      }
    }

    if (buffer.trim().startsWith("data:")) {
      const dataStr = buffer.trim().slice(5).trim();
      if (dataStr !== "[DONE]") {
        try {
          yield JSON.parse(dataStr);
        } catch {
          // Ignored
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run ai-agent/src/engine/__tests__/sse.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit SSE module**

```bash
git add ai-agent/src/types.ts ai-agent/src/engine/sse.ts ai-agent/src/engine/__tests__/sse.test.ts
git commit -m "feat(engine): add core types and lightweight SSE stream decoder"
```

---

### Task 3: SSRF-Guarded Web Tools (Web Fetch & DuckDuckGo Search)

**Files:**
- Create: `ai-agent/src/engine/tools/ssrf.ts`
- Create: `ai-agent/src/engine/tools/web-fetch.ts`
- Create: `ai-agent/src/engine/tools/ddg.ts`
- Test: `ai-agent/src/engine/tools/__tests__/web-tools.test.ts`

**Interfaces:**
- Produces: `isUrlSafe(url: string): Promise<boolean>`, `safeFetchWebPage(url: string): Promise<{ title: string; content: string }>`, `searchDuckDuckGo(query: string): Promise<{ title: string; url: string; snippet: string }[]>`

- [ ] **Step 1: Write failing unit test for SSRF guard and HTML extractor**

Write `ai-agent/src/engine/tools/__tests__/web-tools.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isUrlSafe } from "../ssrf.js";
import { extractCleanText } from "../web-fetch.js";

describe("isUrlSafe", () => {
  it("rejects non-http/https protocols", async () => {
    expect(await isUrlSafe("file:///etc/passwd")).toBe(false);
    expect(await isUrlSafe("ftp://server")).toBe(false);
  });

  it("rejects loopback and private IP addresses", async () => {
    expect(await isUrlSafe("http://localhost:8080")).toBe(false);
    expect(await isUrlSafe("http://127.0.0.1:3000")).toBe(false);
    expect(await isUrlSafe("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(await isUrlSafe("http://192.168.1.1")).toBe(false);
    expect(await isUrlSafe("http://10.0.0.5")).toBe(false);
  });

  it("allows public domain names", async () => {
    expect(await isUrlSafe("https://example.com")).toBe(true);
    expect(await isUrlSafe("https://en.wikipedia.org/wiki/Linux")).toBe(true);
  });
});

describe("extractCleanText", () => {
  it("strips scripts, styles, and extract readable content", () => {
    const html = `
      <html>
        <head><title>Test Page</title><script>alert(1)</script></head>
        <body>
          <style>.hide { display: none; }</style>
          <h1>Heading</h1>
          <p>This is main content.</p>
        </body>
      </html>
    `;
    const { title, content } = extractCleanText(html);
    expect(title).toBe("Test Page");
    expect(content).toContain("Heading");
    expect(content).toContain("This is main content.");
    expect(content).not.toContain("alert(1)");
    expect(content).not.toContain("display: none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ai-agent/src/engine/tools/__tests__/web-tools.test.ts`
Expected: FAIL (cannot find modules).

- [ ] **Step 3: Implement SSRF guard (`ssrf.ts`)**

Write `ai-agent/src/engine/tools/ssrf.ts`:
```ts
import dns from "node:dns/promises";
import net from "node:net";

export async function isUrlSafe(targetUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname;
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }

    let ip = hostname;
    if (!net.isIP(hostname)) {
      try {
        const lookup = await dns.lookup(hostname);
        ip = lookup.address;
      } catch {
        return false;
      }
    }

    if (isPrivateIP(ip)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    // 127.0.0.0/8
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link-local & AWS metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0
    if (parts[0] === 0) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
      return true;
    }
  }

  return false;
}
```

- [ ] **Step 4: Implement safe web fetch and HTML extractor (`web-fetch.ts`)**

Write `ai-agent/src/engine/tools/web-fetch.ts`:
```ts
import { isUrlSafe } from "./ssrf.js";

export function extractCleanText(html: string): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "Web Page";

  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ");

  cleaned = cleaned
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  // Cap at ~15,000 characters to prevent context overflow
  const content = cleaned.slice(0, 15000);
  return { title, content };
}

export async function safeFetchWebPage(
  url: string,
  signal?: AbortSignal
): Promise<{ title: string; content: string }> {
  if (!(await isUrlSafe(url))) {
    throw new Error(`Access to target URL blocked by SSRF policy: ${url}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, {
      signal: signal || controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VicinaeAIAgent/1.0)",
        Accept: "text/html,text/plain,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!resp.ok) {
      throw new Error(`HTTP Error ${resp.status}: ${resp.statusText}`);
    }

    // Re-verify redirected final URL
    if (resp.url && !(await isUrlSafe(resp.url))) {
      throw new Error(`Redirect to unsafe URL blocked: ${resp.url}`);
    }

    const contentType = resp.headers.get("content-type") || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/json")
    ) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const text = await resp.text();
    return extractCleanText(text);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

- [ ] **Step 5: Implement DuckDuckGo Search (`ddg.ts`)**

Write `ai-agent/src/engine/tools/ddg.ts`:
```ts
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchDuckDuckGo(
  query: string,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
      Accept: "text/html",
    },
  });

  if (!resp.ok) {
    throw new Error(`DuckDuckGo search error: ${resp.status}`);
  }

  const html = await resp.text();
  const results: SearchResult[] = [];

  // Match result links: class="result__a" href="..."
  const resultRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
    let rawUrl = match[1];
    // DuckDuckGo redirects through /l/?uddg=<encoded_url>
    const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        rawUrl = decodeURIComponent(uddgMatch[1]);
      } catch {
        // Keep rawUrl
      }
    }

    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();

    if (rawUrl.startsWith("http") && title) {
      results.push({ title, url: rawUrl, snippet });
    }
  }

  return results;
}
```

- [ ] **Step 6: Run tests and verify they pass**

Run: `npx vitest run ai-agent/src/engine/tools/__tests__/web-tools.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit web tools**

```bash
git add ai-agent/src/engine/tools
git commit -m "feat(engine): add SSRF-guarded web fetch and DuckDuckGo search"
```

---

### Task 4: OpenRouter Client with Native Server Tools & Reasoning

**Files:**
- Create: `ai-agent/src/engine/openrouter.ts`
- Test: `ai-agent/src/engine/__tests__/openrouter.test.ts`

**Interfaces:**
- Produces: `streamOpenRouter(messages: Message[], config: ProviderConfig, onEvent: (ev: StreamEvent) => void, signal?: AbortSignal): Promise<void>`
- Consumes: `parseSSEStream` from `sse.ts`, OpenRouter Chat Completions endpoint.

- [ ] **Step 1: Write unit test for OpenRouter response processing**

Write `ai-agent/src/engine/__tests__/openrouter.test.ts` testing handling of text deltas, reasoning chunks, and citation parsing:
```ts
import { describe, it, expect, vi } from "vitest";
import { streamOpenRouter } from "../openrouter.js";
import { Message, StreamEvent } from "../../types.js";

describe("streamOpenRouter", () => {
  it("streams tokens, reasoning, and done event", async () => {
    const sseResponse = [
      ": OPENROUTER PROCESSING\n\n",
      "data: {\"choices\": [{\"delta\": {\"reasoning_content\": \"Thinking step\"}}]}\n\n",
      "data: {\"choices\": [{\"delta\": {\"content\": \"Final answer\"}}]}\n\n",
      "data: [DONE]\n\n",
    ].join("");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseResponse));
          controller.close();
        },
      }),
    });

    const events: StreamEvent[] = [];
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await streamOpenRouter(
      messages,
      {
        apiKey: "sk-or-test",
        modelId: "anthropic/claude-3.7-sonnet",
        enableWebSearch: true,
        systemPrompt: "You are helpful",
      },
      (ev) => events.push(ev)
    );

    expect(events).toContainEqual({ type: "reasoning", text: "Thinking step" });
    expect(events).toContainEqual({ type: "token", text: "Final answer" });
    expect(events).toContainEqual({ type: "done" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ai-agent/src/engine/__tests__/openrouter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement streamOpenRouter**

Write `ai-agent/src/engine/openrouter.ts`:
```ts
import { Message, StreamEvent, Citation } from "../types.js";
import { parseSSEStream } from "./sse.js";

export interface OpenRouterConfig {
  apiKey: string;
  modelId: string;
  enableWebSearch: boolean;
  systemPrompt?: string;
}

export async function streamOpenRouter(
  messages: Message[],
  config: OpenRouterConfig,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!config.apiKey) {
    throw new Error("OpenRouter API key is not configured. Please open extension preferences.");
  }

  const payloadMessages = [];
  if (config.systemPrompt) {
    payloadMessages.push({ role: "system", content: config.systemPrompt });
  }

  // Pass last 10 messages for context
  for (const m of messages.slice(-10)) {
    payloadMessages.push({ role: m.role, content: m.content });
  }

  const tools = config.enableWebSearch
    ? [{ type: "openrouter:web_search" }, { type: "openrouter:web_fetch" }]
    : undefined;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "HTTP-Referer": "https://vicinae.com",
      "X-Title": "Vicinae AI Agent",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: payloadMessages,
      stream: true,
      ...(tools ? { tools } : {}),
    }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`OpenRouter Error (${resp.status}): ${errorText}`);
  }

  if (!resp.body) {
    throw new Error("No response body received from OpenRouter");
  }

  const citationsSeen = new Set<string>();

  for await (const chunk of parseSSEStream(resp.body, signal)) {
    if (chunk.error) {
      throw new Error(`OpenRouter Stream Error: ${chunk.error.message || JSON.stringify(chunk.error)}`);
    }

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    if (choice.delta?.reasoning_content) {
      onEvent({ type: "reasoning", text: choice.delta.reasoning_content });
    }

    if (choice.delta?.content) {
      onEvent({ type: "token", text: choice.delta.content });
    }

    // Handle citations if annotations are present in chunk
    if (chunk.annotations?.citations) {
      for (const c of chunk.annotations.citations) {
        if (c.url && !citationsSeen.has(c.url)) {
          citationsSeen.add(c.url);
          onEvent({ type: "citation", citation: { title: c.title || c.url, url: c.url } });
        }
      }
    }
  }

  onEvent({ type: "done" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run ai-agent/src/engine/__tests__/openrouter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit OpenRouter client**

```bash
git add ai-agent/src/engine/openrouter.ts ai-agent/src/engine/__tests__/openrouter.test.ts
git commit -m "feat(engine): implement OpenRouter streaming client with server tools"
```

---

### Task 5: Google Gemini REST Client with Search Grounding

**Files:**
- Create: `ai-agent/src/engine/gemini.ts`
- Test: `ai-agent/src/engine/__tests__/gemini.test.ts`

**Interfaces:**
- Produces: `streamGemini(messages: Message[], config: GeminiConfig, onEvent: (ev: StreamEvent) => void, signal?: AbortSignal): Promise<void>`
- Consumes: Gemini REST SSE endpoint with `x-goog-api-key` header and `tools: [{ googleSearch: {} }]`.

- [ ] **Step 1: Write unit test for Gemini client**

Write `ai-agent/src/engine/__tests__/gemini.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { streamGemini } from "../gemini.js";
import { Message, StreamEvent } from "../../types.js";

describe("streamGemini", () => {
  it("sends x-goog-api-key header and parses content & grounding chunks", async () => {
    const sseResponse = [
      "data: {\"candidates\": [{\"content\": {\"parts\": [{\"text\": \"Gemini answer\"}]}, \"groundingMetadata\": {\"groundingChunks\": [{\"web\": {\"title\": \"Google\", \"uri\": \"https://google.com\"}}]}}]}\n\n",
    ].join("");

    let capturedHeaders: HeadersInit | undefined;
    let capturedUrl: string = "";

    global.fetch = vi.fn().mockImplementation((url, init) => {
      capturedUrl = url;
      capturedHeaders = init?.headers;
      return Promise.resolve({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseResponse));
            controller.close();
          },
        }),
      });
    });

    const events: StreamEvent[] = [];
    const messages: Message[] = [
      { id: "1", role: "user", content: "Search test", timestamp: Date.now() },
    ];

    await streamGemini(
      messages,
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-2.0-flash",
        enableWebSearch: true,
        systemPrompt: "Be brief",
      },
      (ev) => events.push(ev)
    );

    // Verify API key is NOT in the URL
    expect(capturedUrl).not.toContain("AIzaSyTestKey");
    // Verify API key IS in header
    expect((capturedHeaders as any)["x-goog-api-key"]).toBe("AIzaSyTestKey");
    expect(events).toContainEqual({ type: "token", text: "Gemini answer" });
    expect(events).toContainEqual({
      type: "citation",
      citation: { title: "Google", url: "https://google.com" },
    });
    expect(events).toContainEqual({ type: "done" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ai-agent/src/engine/__tests__/gemini.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement streamGemini**

Write `ai-agent/src/engine/gemini.ts`:
```ts
import { Message, StreamEvent } from "../types.js";
import { parseSSEStream } from "./sse.js";

export interface GeminiConfig {
  apiKey: string;
  modelId: string;
  enableWebSearch: boolean;
  systemPrompt?: string;
}

export async function streamGemini(
  messages: Message[],
  config: GeminiConfig,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!config.apiKey) {
    throw new Error("Gemini API key is not configured. Please open extension preferences.");
  }

  // Model ID mapping: sanitize prefix if entered with models/
  const cleanModel = config.modelId.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse`;

  const contents = messages.slice(-10).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: any = { contents };

  if (config.systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: config.systemPrompt }],
    };
  }

  if (config.enableWebSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  const resp = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Gemini API Error (${resp.status}): ${errorText}`);
  }

  if (!resp.body) {
    throw new Error("No response body received from Gemini");
  }

  const seenUrls = new Set<string>();

  for await (const chunk of parseSSEStream(resp.body, signal)) {
    const candidate = chunk.candidates?.[0];
    if (!candidate) continue;

    const parts = candidate.content?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.text) {
          onEvent({ type: "token", text: part.text });
        }
      }
    }

    const groundingChunks = candidate.groundingMetadata?.groundingChunks;
    if (Array.isArray(groundingChunks)) {
      for (const g of groundingChunks) {
        if (g.web?.uri && !seenUrls.has(g.web.uri)) {
          seenUrls.add(g.web.uri);
          onEvent({
            type: "citation",
            citation: {
              title: g.web.title || g.web.uri,
              url: g.web.uri,
            },
          });
        }
      }
    }
  }

  onEvent({ type: "done" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run ai-agent/src/engine/__tests__/gemini.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Gemini client**

```bash
git add ai-agent/src/engine/gemini.ts ai-agent/src/engine/__tests__/gemini.test.ts
git commit -m "feat(engine): implement Google Gemini client with search grounding and header auth"
```

---

### Task 6: OpenAI & Ollama Client with Tool Delta Accumulator & Tool Loop

**Files:**
- Create: `ai-agent/src/engine/openai.ts`
- Test: `ai-agent/src/engine/__tests__/openai.test.ts`

**Interfaces:**
- Produces: `streamOpenAI(messages: Message[], config: OpenAIConfig, onEvent: (ev: StreamEvent) => void, signal?: AbortSignal): Promise<void>`
- Consumes: OpenAI Chat Completions SSE endpoint, tool execution loop (`ddg.ts` & `web-fetch.ts`).

- [ ] **Step 1: Write unit test for OpenAI tool delta accumulator and fallback**

Write `ai-agent/src/engine/__tests__/openai.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { streamOpenAI } from "../openai.js";
import { Message, StreamEvent } from "../../types.js";

describe("streamOpenAI", () => {
  it("accumulates fragmented tool calls across chunks and streams response", async () => {
    // 1st request returns tool call delta across two chunks
    const toolCallStream = [
      "data: {\"choices\": [{\"delta\": {\"tool_calls\": [{\"index\": 0, \"id\": \"call_1\", \"function\": {\"name\": \"search_web\", \"arguments\": \"{\\\"qu\"}}]}}]}\n\n",
      "data: {\"choices\": [{\"delta\": {\"tool_calls\": [{\"index\": 0, \"function\": {\"arguments\": \"ery\\\": \\\"linux\\\"}\"}}]}}]}\n\n",
      "data: {\"choices\": [{\"finish_reason\": \"tool_calls\"}]}\n\n",
      "data: [DONE]\n\n",
    ].join("");

    // 2nd request returns final text answer
    const answerStream = [
      "data: {\"choices\": [{\"delta\": {\"content\": \"Linux is open source.\"}}]}\n\n",
      "data: [DONE]\n\n",
    ].join("");

    let requestCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      requestCount++;
      const text = requestCount === 1 ? toolCallStream : answerStream;
      return Promise.resolve({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
          },
        }),
      });
    });

    const events: StreamEvent[] = [];
    const messages: Message[] = [
      { id: "1", role: "user", content: "Tell me about linux", timestamp: Date.now() },
    ];

    await streamOpenAI(
      messages,
      {
        apiKey: "sk-test",
        modelId: "gpt-4o-mini",
        enableWebSearch: true,
        baseUrl: "https://api.openai.com/v1",
      },
      (ev) => events.push(ev)
    );

    expect(events).toContainEqual({
      type: "status",
      message: 'Searching web for "linux"...',
    });
    expect(events).toContainEqual({ type: "token", text: "Linux is open source." });
    expect(events).toContainEqual({ type: "done" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ai-agent/src/engine/__tests__/openai.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement streamOpenAI with tool delta accumulator**

Write `ai-agent/src/engine/openai.ts`:
```ts
import { Message, StreamEvent } from "../types.js";
import { parseSSEStream } from "./sse.js";
import { searchDuckDuckGo } from "./tools/ddg.js";
import { safeFetchWebPage } from "./tools/web-fetch.js";

export interface OpenAIConfig {
  apiKey?: string;
  modelId: string;
  baseUrl?: string;
  enableWebSearch: boolean;
  systemPrompt?: string;
}

const TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for up-to-date real-time information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_web_page",
      description: "Fetch and read clean text content from a web URL",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full http/https URL to read" },
        },
        required: ["url"],
      },
    },
  },
];

export async function streamOpenAI(
  messages: Message[],
  config: OpenAIConfig,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;

  const conversationHistory: any[] = [];
  if (config.systemPrompt) {
    conversationHistory.push({ role: "system", content: config.systemPrompt });
  }

  for (const m of messages.slice(-10)) {
    conversationHistory.push({ role: m.role, content: m.content });
  }

  let turn = 0;
  const maxTurns = 4;
  let useTools = config.enableWebSearch;

  while (turn < maxTurns) {
    turn++;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const isFinalTurn = turn >= maxTurns;
    const bodyPayload: any = {
      model: config.modelId,
      messages: conversationHistory,
      stream: true,
    };

    if (useTools) {
      bodyPayload.tools = TOOLS_SCHEMA;
      if (isFinalTurn) {
        bodyPayload.tool_choice = "none";
      }
    }

    let resp = await fetch(endpoint, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(bodyPayload),
    });

    // Fallback: If model rejects tools (400 / 404), retry once without tools
    if (!resp.ok && useTools && resp.status === 400) {
      onEvent({
        type: "status",
        message: "Model does not support tools. Continuing without web search...",
      });
      useTools = false;
      delete bodyPayload.tools;
      resp = await fetch(endpoint, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify(bodyPayload),
      });
    }

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`OpenAI API Error (${resp.status}): ${err}`);
    }

    if (!resp.body) {
      throw new Error("No response body received");
    }

    // Accumulate tool calls and text
    const toolCallsBuffer: Record<number, { id: string; name: string; arguments: string }> = {};
    let assistantText = "";

    for await (const chunk of parseSSEStream(resp.body, signal)) {
      if (chunk.error) {
        throw new Error(chunk.error.message || JSON.stringify(chunk.error));
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.delta?.content) {
        assistantText += choice.delta.content;
        onEvent({ type: "token", text: choice.delta.content });
      }

      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsBuffer[idx]) {
            toolCallsBuffer[idx] = { id: tc.id || "", name: tc.function?.name || "", arguments: "" };
          }
          if (tc.id) toolCallsBuffer[idx].id = tc.id;
          if (tc.function?.name) toolCallsBuffer[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallsBuffer[idx].arguments += tc.function.arguments;
        }
      }
    }

    const executedTools = Object.values(toolCallsBuffer);
    if (executedTools.length === 0) {
      // Completed normal text generation
      onEvent({ type: "done" });
      return;
    }

    // Append assistant tool calls message to conversation history
    conversationHistory.push({
      role: "assistant",
      content: assistantText || null,
      tool_calls: executedTools.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.arguments },
      })),
    });

    // Execute each tool call
    for (const tool of executedTools) {
      let args: any = {};
      try {
        args = JSON.parse(tool.arguments);
      } catch {
        // Bad JSON arguments from model
      }

      let toolResult = "";
      if (tool.name === "search_web") {
        onEvent({ type: "status", message: `Searching web for "${args.query || ""}"...` });
        try {
          const results = await searchDuckDuckGo(args.query || "", signal);
          toolResult = JSON.stringify(results);
          for (const r of results) {
            onEvent({ type: "citation", citation: { title: r.title, url: r.url } });
          }
        } catch (err: any) {
          toolResult = `Search failed: ${err.message}`;
        }
      } else if (tool.name === "fetch_web_page") {
        onEvent({ type: "status", message: `Reading page ${args.url || ""}...` });
        try {
          const page = await safeFetchWebPage(args.url || "", signal);
          toolResult = JSON.stringify(page);
          onEvent({ type: "citation", citation: { title: page.title, url: args.url } });
        } catch (err: any) {
          toolResult = `Fetch failed: ${err.message}`;
        }
      } else {
        toolResult = "Unknown tool";
      }

      conversationHistory.push({
        role: "tool",
        tool_call_id: tool.id,
        content: toolResult,
      });
    }
  }

  onEvent({ type: "done" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run ai-agent/src/engine/__tests__/openai.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit OpenAI client**

```bash
git add ai-agent/src/engine/openai.ts ai-agent/src/engine/__tests__/openai.test.ts
git commit -m "feat(engine): implement OpenAI client with tool delta accumulator and agent loop"
```

---

### Task 7: Unified Client Dispatcher & Storage Layer

**Files:**
- Create: `ai-agent/src/engine/client.ts`
- Create: `ai-agent/src/storage/history.ts`
- Test: `ai-agent/src/storage/__tests__/history.test.ts`

**Interfaces:**
- Produces: `dispatchAgentChat(messages: Message[], prefs: Preferences, onEvent: (ev: StreamEvent) => void, signal?: AbortSignal): Promise<void>`
- Produces: `loadConversations(): Promise<Conversation[]>`, `saveConversation(c: Conversation): Promise<void>`, `deleteConversation(id: string): Promise<void>`, `clearConversations(): Promise<void>`

- [ ] **Step 1: Write unit test for history and auto-title generator**

Write `ai-agent/src/storage/__tests__/history.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateConversationTitle } from "../history.js";

describe("generateConversationTitle", () => {
  it("generates a clean title truncated at 40 chars", () => {
    const title = generateConversationTitle("What are the key architectural improvements in the Linux kernel 6.14 release?");
    expect(title.length).toBeLessThanOrEqual(43);
    expect(title).toBe("What are the key architectural improveme...");
  });

  it("handles short prompts without ellipsis", () => {
    const title = generateConversationTitle("Hello world");
    expect(title).toBe("Hello world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ai-agent/src/storage/__tests__/history.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement storage layer (`storage/history.ts`)**

Write `ai-agent/src/storage/history.ts`:
```ts
import { LocalStorage } from "@vicinae/api";
import { Conversation } from "../types.js";

const STORAGE_KEY = "vicinae_ai_agent_conversations_v1";

export function generateConversationTitle(firstPrompt: string): string {
  const clean = firstPrompt.replace(/[\n\r]+/g, " ").trim();
  if (clean.length <= 40) return clean;
  return clean.slice(0, 40) + "...";
}

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveConversation(convo: Conversation): Promise<void> {
  const list = await loadConversations();
  const existingIdx = list.findIndex((c) => c.id === convo.id);
  if (existingIdx >= 0) {
    list[existingIdx] = convo;
  } else {
    list.unshift(convo);
  }

  // Keep top 50 conversations
  const capped = list.slice(0, 50);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
}

export async function deleteConversation(id: string): Promise<void> {
  const list = await loadConversations();
  const filtered = list.filter((c) => c.id !== id);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export async function clearConversations(): Promise<void> {
  await LocalStorage.removeItem(STORAGE_KEY);
}
```

- [ ] **Step 4: Implement unified engine client (`engine/client.ts`)**

Write `ai-agent/src/engine/client.ts`:
```ts
import { Message, Preferences, StreamEvent } from "../types.js";
import { streamOpenRouter } from "./openrouter.js";
import { streamGemini } from "./gemini.js";
import { streamOpenAI } from "./openai.js";

export async function dispatchAgentChat(
  messages: Message[],
  prefs: Preferences,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  switch (prefs.provider) {
    case "openrouter":
      return streamOpenRouter(
        messages,
        {
          apiKey: prefs.openrouterApiKey || "",
          modelId: prefs.modelId,
          enableWebSearch: prefs.enableWebSearch,
          systemPrompt: prefs.systemPrompt,
        },
        onEvent,
        signal
      );
    case "gemini":
      return streamGemini(
        messages,
        {
          apiKey: prefs.geminiApiKey || "",
          modelId: prefs.modelId,
          enableWebSearch: prefs.enableWebSearch,
          systemPrompt: prefs.systemPrompt,
        },
        onEvent,
        signal
      );
    case "openai":
      return streamOpenAI(
        messages,
        {
          apiKey: prefs.openaiApiKey || "",
          modelId: prefs.modelId,
          baseUrl: "https://api.openai.com/v1",
          enableWebSearch: prefs.enableWebSearch,
          systemPrompt: prefs.systemPrompt,
        },
        onEvent,
        signal
      );
    case "ollama_custom":
      return streamOpenAI(
        messages,
        {
          apiKey: prefs.openaiApiKey || "",
          modelId: prefs.modelId,
          baseUrl: prefs.customBaseUrl || "http://localhost:11434/v1",
          enableWebSearch: prefs.enableWebSearch,
          systemPrompt: prefs.systemPrompt,
        },
        onEvent,
        signal
      );
    default:
      throw new Error(`Unsupported provider: ${prefs.provider}`);
  }
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `npx vitest run ai-agent/src/storage/__tests__/history.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit unified dispatcher and storage**

```bash
git add ai-agent/src/engine/client.ts ai-agent/src/storage
git commit -m "feat: add unified client dispatcher and LocalStorage persistence"
```

---

### Task 8: Vicinae Chat UI Command (`ask.tsx`)

**Files:**
- Create: `ai-agent/src/ask.tsx`

**Interfaces:**
- Produces: Default export React component rendering `<List isShowingDetail filtering={false} searchText={prompt} onSearchTextChange={setPrompt}>` with `<List.Item detail={<List.Item.Detail markdown={markdown} />} />`.
- Consumes: `@vicinae/api`, `dispatchAgentChat`, `saveConversation`, `loadConversations`.

- [ ] **Step 1: Implement `ask.tsx` with throttled rendering and action panel**

Write `ai-agent/src/ask.tsx`:
```tsx
import {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
  useNavigation,
} from "@vicinae/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchAgentChat } from "./engine/client.js";
import { generateConversationTitle, saveConversation } from "./storage/history.js";
import { Citation, Conversation, Message, Preferences } from "./types.js";

export default function Command(props: { conversation?: Conversation }) {
  const prefs = getPreferenceValues<Preferences>();
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    props.conversation ? props.conversation.enableWebSearch : prefs.enableWebSearch
  );

  const [conversation, setConversation] = useState<Conversation>(() => {
    if (props.conversation) return props.conversation;
    return {
      id: String(Date.now()),
      title: "New Conversation",
      provider: prefs.provider,
      modelId: prefs.modelId,
      enableWebSearch: prefs.enableWebSearch,
      systemPrompt: prefs.systemPrompt || "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  });

  const [streamingContent, setStreamingContent] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const bufferRef = useRef({ content: "", reasoning: "" });

  const buildMarkdown = useCallback(() => {
    let md = "";
    if (conversation.messages.length === 0 && !isLoading) {
      md += `# AI Agent Chat\n\n`;
      md += `* **Provider:** \`${conversation.provider}\`\n`;
      md += `* **Model:** \`${conversation.modelId}\`\n`;
      md += `* **Web Search:** ${webSearchEnabled ? "🟢 Enabled" : "⚪ Disabled"}\n\n`;
      md += `Type your prompt into the search bar above and press **Enter** to chat.\n\n`;
      md += `### Keyboard Shortcuts\n`;
      md += `* **Enter:** Send prompt / follow-up\n`;
      md += `* **Ctrl+Shift+W:** Toggle web search on/off\n`;
      md += `* **Ctrl+Shift+N:** New conversation\n`;
      md += `* **Ctrl+Shift+C:** Copy response\n`;
      return md;
    }

    for (const msg of conversation.messages) {
      if (msg.role === "user") {
        md += `### 👤 You\n${msg.content}\n\n`;
      } else {
        md += `### 🤖 Assistant\n`;
        if (msg.reasoning) {
          md += `<details><summary>Thought Process</summary>\n\n${msg.reasoning}\n\n</details>\n\n`;
        }
        md += `${msg.content}\n\n`;
        if (msg.citations && msg.citations.length > 0) {
          md += `**Sources:**\n`;
          msg.citations.forEach((c, idx) => {
            md += `[${idx + 1}] [${c.title}](${c.url})\n`;
          });
          md += `\n`;
        }
      }
      md += `---\n\n`;
    }

    if (isLoading) {
      md += `### 🤖 Assistant *(Generating...)*\n\n`;
      if (statusMessage) {
        md += `> 🌐 *${statusMessage}*\n\n`;
      }
      if (streamingReasoning) {
        md += `<details open><summary>Thinking...</summary>\n\n${streamingReasoning}\n\n</details>\n\n`;
      }
      md += `${streamingContent}\n\n`;
      if (streamingCitations.length > 0) {
        md += `**Sources:**\n`;
        streamingCitations.forEach((c, idx) => {
          md += `[${idx + 1}] [${c.title}](${c.url})\n`;
        });
      }
    }

    return md;
  }, [
    conversation,
    isLoading,
    statusMessage,
    webSearchEnabled,
    streamingContent,
    streamingReasoning,
    streamingCitations,
  ]);

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;

    // Check for API key presence
    if (prefs.provider === "openrouter" && !prefs.openrouterApiKey) {
      showToast({
        style: Toast.Style.Failure,
        title: "OpenRouter API Key Missing",
        message: "Please configure your key in extension preferences.",
        primaryAction: {
          title: "Open Preferences",
          onAction: openExtensionPreferences,
        },
      });
      return;
    }

    if (prefs.provider === "gemini" && !prefs.geminiApiKey) {
      showToast({
        style: Toast.Style.Failure,
        title: "Gemini API Key Missing",
        message: "Please configure your key in extension preferences.",
        primaryAction: {
          title: "Open Preferences",
          onAction: openExtensionPreferences,
        },
      });
      return;
    }

    setPrompt("");
    setIsLoading(true);
    setStatusMessage("");
    setStreamingContent("");
    setStreamingReasoning("");
    setStreamingCitations([]);
    bufferRef.current = { content: "", reasoning: "" };

    const userMsg: Message = {
      id: String(Date.now()),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    const newMessages = [...conversation.messages, userMsg];
    const newTitle =
      conversation.messages.length === 0
        ? generateConversationTitle(trimmed)
        : conversation.title;

    const updatedConvo: Conversation = {
      ...conversation,
      title: newTitle,
      enableWebSearch: webSearchEnabled,
      messages: newMessages,
      updatedAt: Date.now(),
    };

    setConversation(updatedConvo);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const citationsCollected: Citation[] = [];

    try {
      await dispatchAgentChat(
        newMessages,
        {
          ...prefs,
          provider: conversation.provider,
          modelId: conversation.modelId,
          enableWebSearch: webSearchEnabled,
        },
        (ev) => {
          if (ev.type === "token") {
            bufferRef.current.content += ev.text;
            if (!throttleTimeoutRef.current) {
              throttleTimeoutRef.current = setTimeout(() => {
                setStreamingContent(bufferRef.current.content);
                throttleTimeoutRef.current = null;
              }, 70);
            }
          } else if (ev.type === "reasoning") {
            bufferRef.current.reasoning += ev.text;
            setStreamingReasoning(bufferRef.current.reasoning);
          } else if (ev.type === "status") {
            setStatusMessage(ev.message);
          } else if (ev.type === "citation") {
            citationsCollected.push(ev.citation);
            setStreamingCitations([...citationsCollected]);
          } else if (ev.type === "error") {
            showToast({
              style: Toast.Style.Failure,
              title: "Stream Error",
              message: ev.error,
            });
          }
        },
        abortController.signal
      );

      // Flush remaining buffer
      const finalAssistantText = bufferRef.current.content;
      const finalReasoning = bufferRef.current.reasoning;

      const assistantMsg: Message = {
        id: String(Date.now() + 1),
        role: "assistant",
        content: finalAssistantText,
        reasoning: finalReasoning || undefined,
        citations: citationsCollected.length > 0 ? citationsCollected : undefined,
        timestamp: Date.now(),
      };

      const finalConvo: Conversation = {
        ...updatedConvo,
        messages: [...newMessages, assistantMsg],
        updatedAt: Date.now(),
      };

      setConversation(finalConvo);
      // Persist conversation only after completion
      await saveConversation(finalConvo);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        showToast({
          style: Toast.Style.Failure,
          title: "Request Failed",
          message: err.message,
        });
      }
    } finally {
      setIsLoading(false);
      setStatusMessage("");
      abortControllerRef.current = null;
    }
  };

  const handleNewConversation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setConversation({
      id: String(Date.now()),
      title: "New Conversation",
      provider: prefs.provider,
      modelId: prefs.modelId,
      enableWebSearch: prefs.enableWebSearch,
      systemPrompt: prefs.systemPrompt || "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setPrompt("");
    setStreamingContent("");
    setStreamingReasoning("");
    setStreamingCitations([]);
    setIsLoading(false);
  };

  return (
    <List
      isShowingDetail
      filtering={false}
      searchText={prompt}
      onSearchTextChange={setPrompt}
      isLoading={isLoading}
      searchBarPlaceholder={
        isLoading
          ? "AI is responding..."
          : conversation.messages.length > 0
          ? "Ask follow-up..."
          : "Ask AI agent anything (Web search enabled)..."
      }
      actions={
        <ActionPanel>
          <Action title="Submit Prompt" icon={Icon.Message} onAction={handleSubmit} />
          <Action
            title={`Toggle Web Search (${webSearchEnabled ? "Disable" : "Enable"})`}
            icon={Icon.Globe}
            shortcut={{ modifiers: ["cmd", "shift"], key: "w" }}
            onAction={() => {
              setWebSearchEnabled(!webSearchEnabled);
              showToast({
                style: Toast.Style.Success,
                title: !webSearchEnabled ? "Web Search Enabled" : "Web Search Disabled",
              });
            }}
          />
          <Action
            title="Start New Conversation"
            icon={Icon.PlusCircle}
            shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
            onAction={handleNewConversation}
          />
          <Action.CopyToClipboard
            title="Copy Last Answer"
            content={
              conversation.messages.filter((m) => m.role === "assistant").pop()?.content || ""
            }
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Gear}
            onAction={openExtensionPreferences}
          />
        </ActionPanel>
      }
    >
      <List.Item
        title={conversation.title}
        detail={<List.Item.Detail markdown={buildMarkdown()} />}
      />
    </List>
  );
}
```

- [ ] **Step 2: Commit `ask.tsx`**

```bash
git add ai-agent/src/ask.tsx
git commit -m "feat(ui): implement interactive chat command using List isShowingDetail"
```

---

### Task 9: Vicinae Conversations History Command (`conversations.tsx`)

**Files:**
- Create: `ai-agent/src/conversations.tsx`

**Interfaces:**
- Produces: Default export React component rendering `<List />` of past chat sessions with resume and delete actions.
- Consumes: `@vicinae/api`, `loadConversations`, `deleteConversation`, `clearConversations`, `ask.tsx`.

- [ ] **Step 1: Implement `conversations.tsx`**

Write `ai-agent/src/conversations.tsx`:
```tsx
import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useNavigation,
} from "@vicinae/api";
import { useEffect, useState } from "react";
import AskCommand from "./ask.js";
import { clearConversations, deleteConversation, loadConversations } from "./storage/history.js";
import { Conversation } from "./types.js";

export default function ConversationsCommand() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { push } = useNavigation();

  const loadData = async () => {
    setIsLoading(true);
    const list = await loadConversations();
    setConversations(list);
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDelete = async (convo: Conversation) => {
    await deleteConversation(convo.id);
    setConversations((prev) => prev.filter((c) => c.id !== convo.id));
    showToast({ style: Toast.Style.Success, title: "Conversation deleted" });
  };

  const handleClearAll = async () => {
    if (
      await confirmAlert({
        title: "Clear all conversations?",
        message: "This cannot be undone.",
        primaryAction: { title: "Delete All", style: Alert.ActionStyle.Destructive },
      })
    ) {
      await clearConversations();
      setConversations([]);
      showToast({ style: Toast.Style.Success, title: "History cleared" });
    }
  };

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search conversation history...">
      {conversations.length === 0 ? (
        <List.EmptyView
          icon={Icon.Clock}
          title="No Conversations Yet"
          description="Ask questions in the Chat command to start conversations"
        />
      ) : (
        conversations.map((c) => (
          <List.Item
            key={c.id}
            title={c.title}
            subtitle={`${c.provider} • ${c.modelId}`}
            accessories={[
              {
                text: `${c.messages.length} msgs`,
                icon: Icon.Bubble,
              },
              {
                date: new Date(c.updatedAt),
              },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Resume Chat"
                  icon={Icon.ArrowRight}
                  onAction={() => push(<AskCommand conversation={c} />)}
                />
                <Action
                  title="Delete Conversation"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
                  onAction={() => handleDelete(c)}
                />
                <Action
                  title="Clear All History"
                  icon={Icon.XMarkCircle}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
                  onAction={handleClearAll}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
```

- [ ] **Step 2: Commit `conversations.tsx`**

```bash
git add ai-agent/src/conversations.tsx
git commit -m "feat(ui): implement conversation history command with resume and delete"
```

---

### Task 10: Build, Local Installation & End-to-End Verification

**Files:**
- Output: `ai-agent/dist/`
- Target: `~/.local/share/vicinae/extensions/ai-agent/`

- [ ] **Step 1: Run all unit tests**

Run:
```bash
cd /home/pranab/play/vici/ai-agent && npm run test
```
Verify: All unit tests (SSE decoder, SSRF guards, OpenRouter, Gemini, OpenAI, and history storage) pass with 0 failures.

- [ ] **Step 2: Build extension using Vicinae build tool**

Run:
```bash
cd /home/pranab/play/vici/ai-agent && npm run build
```
Verify: Successful compilation into `dist/` with no TypeScript or bundling errors.

- [ ] **Step 3: Install extension to Vicinae local extension directory**

Run:
```bash
mkdir -p ~/.local/share/vicinae/extensions/ai-agent
cp -r /home/pranab/play/vici/ai-agent/dist/* ~/.local/share/vicinae/extensions/ai-agent/
cp /home/pranab/play/vici/ai-agent/package.json ~/.local/share/vicinae/extensions/ai-agent/
cp -r /home/pranab/play/vici/ai-agent/assets ~/.local/share/vicinae/extensions/ai-agent/
```

- [ ] **Step 4: Verify Vicinae command registration**

Run:
```bash
vicinae cmd ls | grep -i "ai-agent"
```
Verify: Output displays both `ai-agent:ask` and `ai-agent:conversations`.

- [ ] **Step 5: Final Git commit**

```bash
git add -A
git commit -m "chore: complete ai-agent extension implementation and local installation"
```
