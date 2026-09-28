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

| Preference Name | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `provider` | `dropdown` | Yes | `openrouter` | AI Provider (`openrouter`, `gemini`, `openai`, `ollama_custom`) |
| `modelId` | `textfield` | Yes | `anthropic/claude-3.7-sonnet` | Exact Model ID to call |
| `openrouterApiKey`| `password` | No | `""` | OpenRouter API Key |
| `geminiApiKey` | `password` | No | `""` | Google Gemini API Key |
| `openaiApiKey` | `password` | No | `""` | OpenAI API Key |
| `customBaseUrl` | `textfield` | No | `http://localhost:11434/v1` | Custom Base URL for Ollama / LocalAI / OpenAI proxies |
| `enableWebSearch` | `checkbox` | Yes | `true` | Enable real-time web search & fetch |
| `systemPrompt` | `textfield` | No | `You are a helpful AI assistant with real-time web access. Format responses cleanly in markdown.` | Custom system prompt / instructions |

> **Credential & Configuration Storage**:
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
  - `model`: User-provided `modelId`
  - `messages`: Current conversation history
  - `stream`: `true`
  - When `enableWebSearch`:
    ```json
    "tools": [
      { "type": "openrouter:web_search" },
      { "type": "openrouter:web_fetch" }
    ]
    ```
- **Web Execution**: OpenRouter runs search and page fetches on their servers. The response streams text chunks directly to the UI. Citations and source links are automatically parsed and formatted.

### 4.2 Google Gemini Client (`gemini.ts`)
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${geminiApiKey}`
- **Payload**:
  - `contents`: Array of role/parts (`user` and `model`)
  - When `enableWebSearch`:
    ```json
    "tools": [{ "googleSearch": {} }]
    ```
- **Web Execution**: Gemini runs Google Search server-side and returns grounded search sources and citations in `candidates[0].groundingMetadata`. The client extracts source URLs and titles and appends them to the answer.

### 4.3 OpenAI & Ollama / Custom Client (`openai.ts`)
- **Endpoint**: `${customBaseUrl || "https://api.openai.com/v1"}/chat/completions`
- **Headers**: `Authorization: Bearer <openaiApiKey>` (optional for Ollama)
- **Tool Execution Loop**:
  - When `enableWebSearch` is true:
    - Provides function tools: `search_web({ query: string })` and `fetch_web_page({ url: string })`.
    - If the model returns `tool_calls`:
      1. Emits status event to UI: "Searching the web for `<query>`..." or "Reading `<url>`...".
      2. Executes DuckDuckGo search or page fetch.
      3. Appends tool result to message history.
      4. Invokes the model again (max 4 turns) until the final answer is streamed.

---

## 5. UI & Interaction Flow

### 5.1 Chat Command (`ask.tsx`)
- **Vicinae Component**: `@vicinae/api`'s `<Detail />` component.
- **Prompt Input**: Uses the top Vicinae search bar (`searchText` / `onSearchTextChange`). Pressing `Enter` commits the prompt, clears the search bar, and starts streaming the response.
- **Streaming View**:
  - Formats user prompt in bold / blockquote.
  - Streams AI markdown live into the Detail body.
  - Displays web search status and citations at the bottom (clickable markdown links).
- **Metadata Sidebar**:
  - Provider, Model ID, Web Search status, Message count.
- **Action Panel**:
  - `Enter`: Submit / Send reply.
  - `Ctrl+N`: New Conversation.
  - `Ctrl+C`: Copy Answer.
  - `Ctrl+W`: Toggle Web Search for current chat.
  - `Ctrl+H`: Open Conversation History.
  - `Ctrl+R`: Regenerate response.

### 5.2 Conversation History Command (`conversations.tsx`)
- **Vicinae Component**: `@vicinae/api`'s `<List />` component.
- **List Items**: Each item shows conversation title, timestamp, model ID, and message count.
- **Actions**:
  - `Enter`: Resume conversation (navigates back to `ask.tsx` with saved state).
  - `Ctrl+X`: Delete conversation.
  - `Ctrl+Shift+X`: Clear all conversation history.

---

## 6. Persistence & Storage (`storage/history.ts`)

- Uses `@vicinae/api` `LocalStorage.getItem` and `LocalStorage.setItem`.
- Storage Key: `vicinae_ai_agent_conversations`.
- Automatically keeps the most recent 50 conversations.

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
