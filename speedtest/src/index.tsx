import React from "react";
import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon
} from "@vicinae/api";
import { useSpeedtest } from "./hooks/useSpeedtest";
import { formatSpeed, renderGauge } from "./engine/utils";
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

  const locParts = [state.server?.city, state.server?.country].filter(Boolean);
  const location = locParts.length > 0 ? locParts.join(", ") : undefined;
  const datacenter = state.server?.colo
    ? `${state.server.colo}${location ? ` (${location})` : ""}`
    : location || "Edge";

  const gauge = renderGauge(state.progressPercent, 100, 14);

  switch (state.phase) {
    case "idle":
      lines.push("# Speedtest");
      lines.push("");
      lines.push("Test network latency, download, and upload speeds via Cloudflare Edge.");
      lines.push("");
      lines.push(`\`${gauge}\` **0%**`);
      lines.push("");
      lines.push("Press **Enter** or select **Restart Test** to start.");
      break;

    case "discovering":
      lines.push("# Speedtest");
      lines.push("");
      lines.push("### 🔍 Locating server...");
      lines.push("");
      lines.push("Connecting to the nearest Cloudflare Edge datacenter.");
      lines.push("");
      lines.push(`\`${gauge}\` **${state.progressPercent}%**`);
      break;

    case "ping": {
      const pingText =
        state.currentPing !== undefined
          ? `${state.currentPing.toFixed(1)} ms`
          : state.ping
          ? `${state.ping.avg.toFixed(1)} ms`
          : "Measuring...";
      lines.push("# Speedtest");
      lines.push("");
      lines.push(`### ⏱️ ${pingText}`);
      lines.push("");
      lines.push(`*Measuring latency & jitter*`);
      lines.push("");
      lines.push(`\`${gauge}\` **${state.progressPercent}%**`);
      if (state.server) {
        lines.push("");
        lines.push(`Connected to **Cloudflare ${datacenter}**`);
      }
      break;
    }

    case "download": {
      const dlSpeed = state.download ? formatSpeed(state.download.currentSpeedMbps) : "—";
      const pingText = state.ping ? `${state.ping.avg.toFixed(1)} ms` : "—";
      lines.push("# Speedtest");
      lines.push("");
      lines.push(`### ⬇️ ${dlSpeed}`);
      lines.push("");
      lines.push(`*Testing download speed*`);
      lines.push("");
      lines.push(`\`${gauge}\` **${state.progressPercent}%**`);
      lines.push("");
      lines.push(`⏱️ Latency: **${pingText}** &nbsp;•&nbsp; Server: **${datacenter}**`);
      break;
    }

    case "upload": {
      const ulSpeed = state.upload ? formatSpeed(state.upload.currentSpeedMbps) : "—";
      const dlSummary = state.download ? formatSpeed(state.download.averageSpeedMbps) : "—";
      const pingText = state.ping ? `${state.ping.avg.toFixed(1)} ms` : "—";
      lines.push("# Speedtest");
      lines.push("");
      lines.push(`### ⬆️ ${ulSpeed}`);
      lines.push("");
      lines.push(`*Testing upload speed*`);
      lines.push("");
      lines.push(`\`${gauge}\` **${state.progressPercent}%**`);
      lines.push("");
      lines.push(`⬇️ Download: **${dlSummary}** &nbsp;•&nbsp; ⏱️ Latency: **${pingText}**`);
      break;
    }

    case "complete": {
      const dlFinal = state.download ? formatSpeed(state.download.averageSpeedMbps) : "—";
      const ulFinal = state.upload ? formatSpeed(state.upload.averageSpeedMbps) : "—";
      const pingText = state.ping ? `${state.ping.avg.toFixed(1)} ms` : "—";
      const jitterText = state.ping ? `${state.ping.jitter.toFixed(1)} ms` : "—";
      lines.push("# Speedtest Results");
      lines.push("");
      lines.push(`### ⬇️ ${dlFinal} &nbsp;&nbsp;&nbsp;&nbsp; ⬆️ ${ulFinal}`);
      lines.push("");
      lines.push(`**⏱️ ${pingText}** &nbsp;•&nbsp; **${jitterText} jitter**`);
      lines.push("");
      lines.push(`\`${gauge}\` **100%**`);
      lines.push("");
      lines.push("---");
      lines.push("");
      lines.push(`**Server:** Cloudflare ${datacenter}  `);
      lines.push(
        `**Network:** ${state.server?.isp || "Cloudflare Edge"}${
          state.server?.asn ? ` (AS${state.server.asn})` : ""
        }`
      );
      break;
    }

    case "error":
      lines.push("# Speedtest Failed");
      lines.push("");
      lines.push(`> ⚠️ **Error:** ${state.error || "An unexpected error occurred during testing."}`);
      lines.push("");
      lines.push(`\`${gauge}\` **${state.progressPercent}%**`);
      lines.push("");
      lines.push("Select **Restart Test** (`⌘R`) to try again.");
      break;

    case "aborted":
      lines.push("# Speedtest Cancelled");
      lines.push("");
      lines.push("The speed test was interrupted and cancelled.");
      lines.push("");
      lines.push(`\`${gauge}\` **${state.progressPercent}%**`);
      lines.push("");
      lines.push("Select **Restart Test** (`⌘R`) to run a new test.");
      break;
  }

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
