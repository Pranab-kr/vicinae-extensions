# Vicinae Extensions Monorepo

A collection of native extensions for the [Vicinae](https://vicinae.com) command launcher. Each extension is self-contained with its own source code, documentation, specifications, assets, and dependencies.

## Extensions

| Extension | Description | Status | Link |
|-----------|-------------|--------|------|
| **AI Agent** | Native AI assistant supporting OpenRouter, Gemini, OpenAI, Ollama, SSRF-safe web search, and expandable reasoning thoughts. | Ready | [`ai-agent/`](ai-agent/) |
| **Speedtest** | Real-time network speed, ping, and jitter telemetry powered by Cloudflare Edge streaming (100% binary-free). | Scaffolded | [`speedtest/`](speedtest/) |

## Repository Structure

```
vici/
├── ai-agent/                     # Vicinae AI Agent extension
│   ├── assets/                   # Extension icons
│   ├── docs/superpowers/         # Design specifications and implementation plans
│   ├── src/                      # Extension React and engine source code
│   ├── package.json              # Vicinae extension manifest
│   ├── README.md                 # Extension documentation
│   ├── tsconfig.json
│   └── vitest.config.ts
├── speedtest/                    # Vicinae Speedtest extension
│   ├── assets/                   # Extension icons
│   ├── docs/superpowers/         # Design specifications and implementation plans
│   ├── src/                      # Extension source code
│   ├── tests/                    # Unit tests
│   ├── package.json              # Vicinae extension manifest
│   ├── README.md                 # Extension documentation
│   ├── tsconfig.json
│   └── vitest.config.ts
└── README.md                     # Root workspace documentation
```

## Getting Started

Each extension is developed independently. To work on an extension, navigate to its directory:

### AI Agent
```bash
cd ai-agent
npm install
npm test
npm run build
```

### Speedtest
```bash
cd speedtest
npm install
npm test
npm run build
```

## License

MIT
