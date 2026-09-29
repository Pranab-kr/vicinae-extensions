import React from "react";
import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon
} from "@vicinae/api";
import { useSpeedtest } from "./hooks/useSpeedtest";
import {
  formatBytes,
  formatDuration,
  formatSpeed,
  renderGauge
} from "./engine/utils";
import type { SpeedtestPhase, SpeedtestState } from "./engine/types";

export function getStatusTag(phase: SpeedtestPhase): { text: string; color: Color } {
  switch (phase) {
    case "idle":
      return { text: "Idle", color: Color.SecondaryText };
    case "discovering":
      return { text: "Discovering Server", color: Color.Yellow };
    case "ping":
      return { text: "Measuring Latency", color: Color.Yellow };
    case "download":
      return { text: "Testing Download", color: Color.Blue };
    case "upload":
      return { text: "Testing Upload", color: Color.Purple };
    case "complete":
      return { text: "Complete", color: Color.Green };
    case "error":
      return { text: "Failed", color: Color.Red };
    case "aborted":
      return { text: "Cancelled", color: Color.Orange };
  }
}

export function buildMarkdown(state: SpeedtestState): string {
  const lines: string[] = [];

  switch (state.phase) {
    case "idle":
      lines.push("# ⚡ Cloudflare Speed Test");
      lines.push("");
      lines.push("Press **Enter** or select **Restart Test** in the action panel to start.");
      break;
    case "discovering":
      lines.push("# 🔍 Speedtest: Discovering Nearest Server...");
      lines.push("");
      lines.push("Locating optimal Cloudflare Edge datacenter and querying network metadata...");
      break;
    case "ping":
      lines.push("# ⏱️ Speedtest: Measuring Latency & Jitter...");
      lines.push("");
      lines.push("Probing Cloudflare Edge network to calculate round-trip time and jitter...");
      break;
    case "download":
      lines.push("# ⬇️ Speedtest: Testing Download Speed...");
      lines.push("");
      lines.push("Streaming multi-megabyte payloads from Cloudflare Edge to determine bandwidth...");
      break;
    case "upload":
      lines.push("# ⬆️ Speedtest: Testing Upload Speed...");
      lines.push("");
      lines.push("Transmitting binary chunks to Cloudflare Edge to measure throughput...");
      break;
    case "complete":
      lines.push("# ✅ Speedtest Complete");
      lines.push("");
      lines.push("Your network performance test has finished successfully!");
      break;
    case "error":
      lines.push("# ❌ Speedtest Failed");
      lines.push("");
      lines.push(`> **Error:** ${state.error || "An unexpected error occurred during testing."}`);
      break;
    case "aborted":
      lines.push("# ⏹️ Speedtest Cancelled");
      lines.push("");
      lines.push("The speed test was interrupted and cancelled.");
      break;
  }

  lines.push("");

  const gauge = renderGauge(state.progressPercent, 100, 20);
  lines.push(`\`${gauge}\` **${state.progressPercent}%**`);
  lines.push("");

  lines.push("### Live Telemetry");
  lines.push("");

  let downloadDisplay = "—";
  if (state.download) {
    if (state.phase === "download") {
      downloadDisplay = `${formatSpeed(state.download.currentSpeedMbps)} (avg: ${formatSpeed(state.download.averageSpeedMbps)})`;
    } else {
      downloadDisplay = `${formatSpeed(state.download.averageSpeedMbps)} (${formatBytes(state.download.bytesTransferred)} in ${formatDuration(state.download.durationMs)})`;
    }
  } else if (state.phase === "discovering" || state.phase === "ping") {
    downloadDisplay = "Waiting...";
  }

  let uploadDisplay = "—";
  if (state.upload) {
    if (state.phase === "upload") {
      uploadDisplay = `${formatSpeed(state.upload.currentSpeedMbps)} (avg: ${formatSpeed(state.upload.averageSpeedMbps)})`;
    } else {
      uploadDisplay = `${formatSpeed(state.upload.averageSpeedMbps)} (${formatBytes(state.upload.bytesTransferred)} in ${formatDuration(state.upload.durationMs)})`;
    }
  } else if (state.phase === "discovering" || state.phase === "ping" || state.phase === "download") {
    uploadDisplay = "Waiting...";
  }

  let pingDisplay = "—";
  if (state.currentPing !== undefined && state.phase === "ping") {
    pingDisplay = `${state.currentPing.toFixed(1)} ms`;
  } else if (state.ping) {
    pingDisplay = `${state.ping.avg.toFixed(1)} ms (min: ${state.ping.min.toFixed(1)} ms)`;
  }

  let jitterDisplay = "—";
  if (state.ping) {
    jitterDisplay = `${state.ping.jitter.toFixed(1)} ms`;
  }

  lines.push(`- **Download:** ${downloadDisplay}`);
  lines.push(`- **Upload:** ${uploadDisplay}`);
  lines.push(`- **Latency (Ping):** ${pingDisplay}`);
  lines.push(`- **Jitter:** ${jitterDisplay}`);
  lines.push("");

  lines.push("### Server & Connection");
  lines.push("");
  lines.push("| Attribute | Value |");
  lines.push("| :--- | :--- |");
  lines.push(`| **Connections** | ${state.concurrency ? `Multi (${state.concurrency} streams)` : "Multi (4 streams)"} |`);
  lines.push(`| **ISP / Network** | ${state.server?.isp || "—"} |`);

  const locParts = [state.server?.city, state.server?.country].filter(Boolean);
  const location = locParts.length > 0 ? locParts.join(", ") : "—";
  lines.push(`| **Location** | ${location} |`);
  lines.push(`| **Datacenter (Colo)** | ${state.server?.colo || "—"} |`);
  lines.push(`| **Client IP** | ${state.server?.ip || "—"} |`);
  lines.push(`| **ASN** | ${state.server?.asn ? `AS${state.server.asn}` : "—"} |`);

  return lines.join("\n");
}

export function generateSummaryMarkdown(state: SpeedtestState): string {
  const locParts = [state.server?.city, state.server?.country].filter(Boolean);
  const location = locParts.length > 0 ? locParts.join(", ") : "Unknown";

  const lines = [
    "# Vicinae Speedtest Results",
    "",
    `- **Status:** ${state.phase.toUpperCase()}`,
    `- **Connections:** ${state.concurrency ? `Multi (${state.concurrency} streams)` : "Multi (4 streams)"}`,
    `- **Download:** ${state.download ? formatSpeed(state.download.averageSpeedMbps) : "N/A"}`,
    `- **Upload:** ${state.upload ? formatSpeed(state.upload.averageSpeedMbps) : "N/A"}`,
    `- **Ping (Avg):** ${state.ping ? `${state.ping.avg.toFixed(1)} ms` : "N/A"}`,
    `- **Ping (Min):** ${state.ping ? `${state.ping.min.toFixed(1)} ms` : "N/A"}`,
    `- **Jitter:** ${state.ping ? `${state.ping.jitter.toFixed(1)} ms` : "N/A"}`,
    `- **ISP:** ${state.server?.isp || "Unknown"}`,
    `- **Datacenter:** ${state.server?.colo || "Unknown"} (${location})`,
    `- **Client IP:** ${state.server?.ip || "Unknown"}`,
    `- **Tested At:** ${state.endTime ? new Date(state.endTime).toISOString() : new Date().toISOString()}`
  ];

  return lines.join("\n");
}

export function generateSummaryJson(state: SpeedtestState): string {
  return JSON.stringify(
    {
      timestamp: state.endTime ? new Date(state.endTime).toISOString() : new Date().toISOString(),
      phase: state.phase,
      progressPercent: state.progressPercent,
      error: state.error || null,
      server: state.server || null,
      ping: state.ping || null,
      download: state.download || null,
      upload: state.upload || null,
      startTime: state.startTime || null,
      endTime: state.endTime || null
    },
    null,
    2
  );
}

export default function Command() {
  const { state, isTesting, startTest, cancelTest } = useSpeedtest();

  const statusTag = getStatusTag(state.phase);
  const markdown = buildMarkdown(state);
  const summaryMarkdown = generateSummaryMarkdown(state);
  const summaryJson = generateSummaryJson(state);

  return (
    <Detail
      navigationTitle="Speedtest"
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item
              text={statusTag.text}
              color={statusTag.color}
            />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Ping"
            text={
              state.currentPing !== undefined && state.phase === "ping"
                ? `${state.currentPing.toFixed(1)} ms`
                : state.ping
                ? `${state.ping.avg.toFixed(1)} ms`
                : "—"
            }
          />
          <Detail.Metadata.Label
            title="Jitter"
            text={state.ping ? `${state.ping.jitter.toFixed(1)} ms` : "—"}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Download"
            text={
              state.download
                ? formatSpeed(
                    state.phase === "download"
                      ? state.download.currentSpeedMbps
                      : state.download.averageSpeedMbps
                  )
                : "—"
            }
          />
          <Detail.Metadata.Label
            title="Upload"
            text={
              state.upload
                ? formatSpeed(
                    state.phase === "upload"
                      ? state.upload.currentSpeedMbps
                      : state.upload.averageSpeedMbps
                  )
                : "—"
            }
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Connections"
            text={state.concurrency ? `Multi (${state.concurrency} streams)` : "Multi (4 streams)"}
          />
          <Detail.Metadata.Label
            title="Server Colo"
            text={state.server?.colo || "—"}
          />
          <Detail.Metadata.Label
            title="ISP"
            text={state.server?.isp || "—"}
          />
          <Detail.Metadata.Label
            title="Client IP"
            text={state.server?.ip || "—"}
          />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action
            title="Restart Test"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={startTest}
          />
          {isTesting && (
            <Action
              title="Cancel Test"
              icon={Icon.XMarkCircle}
              style="destructive"
              shortcut={{ modifiers: ["cmd"], key: "x" }}
              onAction={cancelTest}
            />
          )}
          <Action.CopyToClipboard
            title="Copy Results as Markdown"
            content={summaryMarkdown}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          <Action.CopyToClipboard
            title="Copy Results as JSON"
            content={summaryJson}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        </ActionPanel>
      }
    />
  );
}
