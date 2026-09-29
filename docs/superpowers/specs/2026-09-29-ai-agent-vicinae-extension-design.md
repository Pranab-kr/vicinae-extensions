# AI Agent Vicinae Extension - Design Specification

**Date:** 2026-09-29  
**Extension Name:** `ai-agent`  
**Purpose:** A high-performance, keyboard-first AI agent extension for the Vicinae desktop launcher featuring multi-provider streaming chat (OpenRouter, Google Gemini, OpenAI, and Ollama/Custom endpoints) with real-time web search and page fetching capabilities.

---

## 1. Overview & Goals

- **Interactive Desktop AI Chat**: Fast, native UI inside the Vicinae launcher via `@vicinae/api`.
- **Multi-Provider Support**:
    - **OpenRouter**: Uses OpenRouter's native server tools (`openrouter:web_search` and `openrouter:web_fetch`) for server-side search and page extraction across any tool-calling model.
    - **Google Gemini**: Uses native Gemini Google Search grounding (`tools: [{ googleSearch: {} }]`).
    - **OpenAI / Ollama / Custom**: Local tool execution loop with free DuckDuckGo search and direct web page content extraction.
- **Manual Model ID Configuration**: Explicit textfield input for model IDs (no rigid pre-baked lists or auto-fetching overhead), allowing full flexibility (e.g. `anthropic/claude-3.7-sonnet`, `deepseek/deepseek-r1`, `gemini-2.0-flash`, `gpt-4o`, etc.).
- **Conversation History**: Persistent chat sessions saved via Vicinae's `LocalStorage` with resume and deletion capabilities.
- **Local Personal Use**: Self-contained, built with `vici build`, installable directly into `~/.local/share/vicinae/extensions/ai-agent`.

---

## 2. Extension Preferences & Configuration

Defined in `package.json` under `"preferences"`:

| Preference Name    | Type        | Required | Default                                                                                           | Description                                                     |
| :----------------- | :---------- | :------- | :------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------- |
| `provider`         | `dropdown`  | Yes      | `openrouter`                                                                                      | AI Provider (`openrouter`, `gemini`, `openai`, `ollama_custom`) |
| `modelId`          | `textfield` | Yes      | `anthropic/claude-3.7-sonnet`                                                                     | Exact Model ID to call                                          |
| `openrouterApiKey` | `password`  | No       | `""`                                                                                              | OpenRouter API Key                                              |
| `geminiApiKey`     | `password`  | No       | `""`                                                                                              | Google Gemini API Key                                           |
| `openaiApiKey`     | `password`  | No       | `""`                                                                                              | OpenAI API Key                                                  |
| `customBaseUrl`    | `textfield` | No       | `http://localhost:11434/v1`                                                                       | Custom Base URL for Ollama / LocalAI / OpenAI proxies           |
| `enableWebSearch`  | `checkbox`  | Yes      | `true`                                                                                            | Enable real-time web search & fetch                             |
| `systemPrompt`     | `textfield` | No       | `You are a helpful AI assistant with real-time web access. Format responses cleanly in markdown.` | Custom system prompt / instructions                             |

> **Credential & Configuration Storage**:
>
> - Saved locally by Vicinae in `~/.config/vicinae/settings.json` under `"providers"."ai-agent"."preferences"`.
> - **Explicit Entry Only**: API keys are strictly retrieved from what you enter in the extension preferences GUI (no reading from `process.env`).
> - **Custom System Prompt**: Fully customizable in preferences to define the agent's persona, formatting rules, tone, and guidelines.

---

## 3. Project Structure

```text
/home/pranab/play/vici/ai-agent/
├── package.json               # Manifest, commands, preferences, dependencies
├── tsconfig.json              # TypeScript compiler settings
├── assets/
│   ├── icon.png               # Extension icon
│   └── web-search.png         # Command icon
├── src/
│   ├── ask.tsx                # Main Chat View Command (Detail view + streaming markdown)
│   ├── conversations.tsx      # Conversation History Command (List view)
│   ├── types.ts               # Shared types: Message, Conversation, Preferences, StreamChunk
│   ├── storage/
│   │   └── history.ts         # LocalStorage persistence for conversations
│   └── engine/
│       ├── client.ts          # Unified AI agent runner interface
│       ├── sse.ts             # Lightweight SSE stream decoder (~35 lines)
│       ├── openrouter.ts      # OpenRouter API client with server-side web tools
│       ├── gemini.ts          # Google Gemini REST client with Google Search grounding
│       ├── openai.ts          # OpenAI/Ollama client with tool execution loop
│       └── tools/
│           ├── ddg.ts         # Free DuckDuckGo instant search & HTML parser
│           └── web-fetch.ts   # Direct URL text extractor (readability/clean markdown)
```

---

## 4. Multi-Provider & Web Search Engine

### 4.1 OpenRouter Client (`openrouter.ts`)
- **Endpoint**: `https://openrouter.ai/api/v1/chat/completions`
- **Headers**: `Authorization: Bearer <openrouterApiKey>`, `HTTP-Referer: https://vicinae.com`, `X-Title: Vicinae AI Agent`
- **Payload**:
  - `model`: User-configured `modelId`
  - `messages`: Conversation history with system prompt
  - `stream`: `true`
  - When `enableWebSearch`:
    ```json
    "tools": [
      { "type": "openrouter:web_search" },
      { "type": "openrouter:web_fetch" }
    ]
    ```
- **Stream Handling**:
  - Ignore SSE comments / keepalives (lines starting with `:` such as `: PROCESSING`).
  - Handle mid-stream error payloads (`data: {"error": ...}`).
  - Handle reasoning models (`delta.reasoning_content`) in collapsible markdown blocks.
  - Automatically parse annotations and citation URLs.

### 4.2 Google Gemini Client (`gemini.ts`)
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse`
- **Headers**: `x-goog-api-key: ${geminiApiKey}` (key sent in header, not in URL query string)
- **Payload**:
  - `systemInstruction`: `{ parts: [{ text: systemPrompt }] }`
  - `contents`: Array of `{ role: "user" | "model", parts: [{ text: ... }] }` (maps `assistant` -> `model`)
  - When `enableWebSearch`:
    ```json
    "tools": [{ "googleSearch": {} }]
    ```
- **Web Execution & Grounding**: Google runs search server-side. Citations and source titles are extracted from `candidates[0].groundingMetadata.groundingChunks` and rendered at the end of the response.

### 4.3 OpenAI & Ollama / Custom Client (`openai.ts`)
- **Endpoint**: `${customBaseUrl || "https://api.openai.com/v1"}/chat/completions`
- **Headers**: `Authorization: Bearer <openaiApiKey>` (optional for Ollama)
- **Streaming & Tool Delta Accumulator**:
  - Tool calls arrive across multiple chunks (`delta.tool_calls[i].function.arguments`). The client accumulates fragments into a tool-call buffer until `finish_reason === "tool_calls"`.
- **Tool Execution Loop**:
  - Provides function tools: `search_web({ query: string })` and `fetch_web_page({ url: string })`.
  - Max loop limit: 4 iterations. On the final iteration, sends `tool_choice: "none"` to force answer synthesis.
  - If the model rejects tools (returns 400 "tools not supported"), retries automatically once without tools and shows a warning toast.

### 4.4 SSRF-Guarded Web Tools (`tools/web-fetch.ts` and `tools/ddg.ts`)
- **SSRF Protection**:
  - Only `http:` and `https:` schemes allowed.
  - IP verification: Block localhost (`127.0.0.0/8`, `::1`), private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and link-local / cloud metadata ranges (`169.254.0.0/16`, `fc00::/7`).
  - Redirect protection: Re-validate target IP addresses on each HTTP redirect.
  - Limits: 8-second timeout, 500KB content limit, and `Content-Type` validation (`text/html`, `text/plain`, `application/json`).
  - Lightweight HTML-to-text parser (strips scripts, styles, navigation and extracts core text without heavy DOM dependencies).
- **DuckDuckGo Fetcher**:
  - Queries DuckDuckGo HTML endpoint, handles `uddg=` redirect unescaping, and extracts title, snippet, and source URL.

---

## 5. UI & Interaction Flow

### 5.1 Chat Command (`ask.tsx`)
- **Vicinae Component**: `<List isShowingDetail filtering={false} searchText={prompt} onSearchTextChange={setPrompt}>`
  - In `@vicinae/api`, `<List>` provides the active search bar as the input field (`<Detail>` does not support `searchText`).
  - The item `<List.Item detail={<List.Item.Detail markdown={threadMarkdown} />} />` renders the streaming conversation markdown, reasoning blocks, status banners, and citation lists.
- **Render Throttling**: Updates to state are throttled to ~60–80ms to prevent high-frequency stream chunks from causing React render lag.
- **AbortController**: Active requests are cancelled when pressing `Esc`, submitting a new prompt, or starting a new conversation.
- **Action Panel**:
  - `Enter`: Submit prompt / Send reply.
  - `Ctrl+Shift+N`: New Conversation.
  - `Ctrl+Shift+C`: Copy Answer.
  - `Ctrl+Shift+W`: Toggle Web Search for the current conversation.
  - `Ctrl+Shift+H`: View Conversation History.
  - `Ctrl+Shift+R`: Regenerate response.

### 5.2 Conversation History Command (`conversations.tsx`)
- **Vicinae Component**: `<List />` showing past chats.
- **List Items**: Title (auto-generated from first prompt, max 40 chars), relative timestamp, provider, model ID, and message count.
- **Actions**:
  - `Enter`: Resume conversation (loads active conversation into `ask.tsx`).
  - `Ctrl+Shift+X`: Delete conversation.
  - `Ctrl+Shift+BackSpace`: Clear all history.

---

## 6. Persistence & Storage (`storage/history.ts`)

- Uses `@vicinae/api` `LocalStorage`.
- State is committed to disk **only after a response finishes streaming**, never on per-token deltas.
- Each conversation persists its own `provider`, `modelId`, and `enableWebSearch` state to avoid model mixing when preferences change.
- Automatic context capping: Passes the last 10 messages to the model to stay within token limits.

---

## 7. Error Handling & Guardrails

1. **Missing Configuration**:
   - If user attempts to chat without configuring an API key or Model ID, show a descriptive error toast: `"Missing API Key or Model ID"` with an action to open extension preferences (`openExtensionPreferences()`).
2. **Network Timeouts & API Errors**:
   - Stream errors display directly inside the Detail view with actionable error summaries (e.g. `401 Unauthorized: check your API key`, `404 Model Not Found`, `Connection Refused: check Ollama endpoint`).
3. **Web Search Fallbacks**:
   - If DuckDuckGo or web page scraping fails, log a warning and let the model answer with its training knowledge rather than crashing the session.

---

## 8. Build & Local Installation

1. Initialize project in `/home/pranab/play/vici/ai-agent`.
2. Install dependencies:
    ```bash
    npm install
    ```
3. Compile with Vicinae compiler:
    ```bash
    npm run build # runs "vici build"
    ```
4. Install to local Vicinae directory:
    ```bash
    mkdir -p ~/.local/share/vicinae/extensions/ai-agent
    cp -r dist/* ~/.local/share/vicinae/extensions/ai-agent/ # or symlink
    ```
5. Vicinae automatically detects the new commands in `vicinae cmd ls` without restarting.
