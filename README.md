# Vicinae AI Agent Extension

A powerful, native AI assistant extension for [Vicinae](https://vicinae.com) launcher, supporting multiple AI backends, real-time web search with SSRF-safe page fetching, streaming reasoning thoughts, and persistent conversation history.

## Features

- 🚀 **Multi-Provider Support**: Seamlessly chat with:
  - **OpenRouter** (Claude 3.7 / 3.5 Sonnet, DeepSeek R1, LLaMA 3.3, etc.)
  - **Google Gemini** (Gemini 2.5 Flash, Gemini Pro, etc.)
  - **OpenAI** (GPT-4o, o3-mini, etc.)
  - **Ollama / LocalAI / Custom OpenAI-compatible endpoints** (Self-hosted local models)
- 🌐 **Real-Time Web Search & Fetching**:
  - Live search powered by DuckDuckGo and SSRF-protected webpage content fetching.
  - Automatically supplies cited sources directly in answers.
- 💭 **Thinking / Reasoning Visibility**:
  - Expandable and collapsible thought processes (DeepSeek R1 reasoning, Claude reasoning, etc.) with `Ctrl+Shift+T`.
- ⚡ **Full-Width Streaming Chat UI**:
  - Optimized streaming rendering using Vicinae's `<Detail>` markdown view with zero flicker and continuous auto-scrolling.
  - Follow-up prompts via `Enter` or the action panel.
- 📚 **Conversation History & Management**:
  - Browse past chat sessions with resumption and search.
  - In-place conversation renaming with `Ctrl+Shift+R`.

## Project Structure

```
├── ai-agent/              # Extension source code
│   ├── src/
│   │   ├── ask.tsx        # Main chat command UI & state
│   │   ├── conversations.tsx # History browsing & management
│   │   ├── rename-modal.tsx # Conversation renaming modal
│   │   ├── engine/        # Streaming clients (OpenRouter, Gemini, OpenAI, SSE)
│   │   │   └── tools/     # SSRF filter, DuckDuckGo search, safe web fetch
│   │   ├── storage/       # LocalStorage conversation persistence
│   │   └── types.ts       # Shared TypeScript types
│   ├── assets/            # Extension icons and assets
│   ├── package.json       # Manifest and preferences schema
│   └── vitest.config.ts   # Unit test configuration
└── docs/                  # Design documents & implementation plans
```

## Getting Started

### Prerequisites

- Node.js (>= 18)
- Vicinae Launcher (`vici` CLI) installed

### Installation & Development

1. Navigate to the extension directory:
   ```bash
   cd ai-agent
   npm install
   ```

2. Run the test suite:
   ```bash
   npm test
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Install locally to Vicinae:
   ```bash
   mkdir -p ~/.local/share/vicinae/extensions/ai-agent
   cp -r dist/* ~/.local/share/vicinae/extensions/ai-agent/
   ```

## License

MIT
