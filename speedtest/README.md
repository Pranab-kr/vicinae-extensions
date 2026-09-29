# Vicinae Speedtest Extension

A lightweight, real-time internet speed and network latency test extension for [Vicinae](https://vicinae.com) launcher powered by Cloudflare Edge (`speed.cloudflare.com`).

## Features

- ⚡ **Zero External Binaries**: Pure native TypeScript implementation using Node.js streaming APIs.
- ⏱️ **Real-Time Telemetry**: Live download speed, upload speed, latency (ping), and jitter measurements.
- 🎨 **Native Vicinae UX**: High-fidelity `<Detail>` markdown view with dynamic progress and status tags.
- 🔒 **Privacy-First & Ephemeral**: Zero history files saved to disk; tests execute entirely on-demand.

## Documentation

- [Design Specification](docs/superpowers/specs/2026-09-29-vicinae-speedtest-design.md)
- [Implementation Plan](docs/superpowers/plans/2026-09-29-vicinae-speedtest.md)

## Development

1. Navigate to the extension directory:
   ```bash
   cd speedtest
   npm install
   ```

2. Run test suite:
   ```bash
   npm test
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

## License

MIT
