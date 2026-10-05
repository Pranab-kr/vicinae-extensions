import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Message, StreamEvent } from "../types.js";

export interface OpenCodeConfig {
  modelId?: string;
  sessionId?: string;
  systemPrompt?: string;
  cwd?: string;
  onSessionId?: (sessionId: string) => void;
}

/**
 * Checks if opencode CLI binary is available on the system PATH.
 */
export async function isOpenCodeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn("opencode", ["--version"], { stdio: "ignore" });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

function extractCitationsFromOutput(
  toolName: string,
  output: string,
  onEvent: (ev: StreamEvent) => void,
  seenUrls: Set<string>
) {
  // Only extract citations from search and web reading tools, NOT bash or file commands!
  if (toolName !== "websearch" && toolName !== "webfetch") {
    return;
  }

  // Cap total citations to prevent massive lists
  if (seenUrls.size >= 10) {
    return;
  }

  const isJunkUrl = (url: string) =>
    url.includes("avatars.githubusercontent.com") ||
    url.includes("{?") ||
    (url.includes("?") && url.includes("{")) ||
    url.endsWith(".ico") ||
    /\.(png|jpe?g|gif|svg|webp)(\?.*)?$/i.test(url);

  // Pattern 1: Title: ... \nURL: https://...
  const titleUrlRegex = /Title:\s*([^\n]+)\s*\nURL:\s*(https?:\/\/[^\s\n]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = titleUrlRegex.exec(output)) !== null && seenUrls.size < 10) {
    const title = match[1].trim();
    const url = match[2].trim();
    if (url && !seenUrls.has(url) && !isJunkUrl(url)) {
      seenUrls.add(url);
      onEvent({
        type: "citation",
        citation: { title: title || url, url },
      });
    }
  }

  // Pattern 2: Standalone URLs in text if not matched above
  const urlRegex = /https?:\/\/[^\s)\]>"']+/gi;
  while ((match = urlRegex.exec(output)) !== null && seenUrls.size < 10) {
    const url = match[0].trim().replace(/[.,;:]+$/, "");
    if (url && !seenUrls.has(url) && !isJunkUrl(url)) {
      seenUrls.add(url);
      onEvent({
        type: "citation",
        citation: { title: url, url },
      });
    }
  }
}

function formatToolStatus(part: any): string {
  const toolName = part.tool || "";
  const toolState = part.state;

  if (toolName === "bash") {
    const rawCmd = (toolState?.input?.command || toolState?.title || "").trim();
    const cleanCmd = rawCmd.replace(/\s+/g, " ");
    const shortCmd = cleanCmd.length > 25 ? `${cleanCmd.slice(0, 22)}...` : cleanCmd;
    return shortCmd ? `Running: ${shortCmd}` : "Running command...";
  }

  if (toolName === "websearch") {
    const query = (toolState?.input?.query || "").trim();
    const shortQuery = query.length > 22 ? `${query.slice(0, 19)}...` : query;
    return shortQuery
      ? `Searching: "${shortQuery}"`
      : toolState?.title && toolState.title.length <= 35
        ? toolState.title
        : "Searching web...";
  }

  if (toolName === "webfetch") {
    const url = (toolState?.input?.url || "").trim();
    let label = url;
    try {
      label = new URL(url).hostname;
    } catch {}
    const shortLabel = label.length > 22 ? `${label.slice(0, 19)}...` : label;
    return shortLabel ? `Fetching ${shortLabel}...` : "Fetching webpage...";
  }

  const title = (toolState?.title || (toolName ? `Using ${toolName}` : "Processing...")).trim();
  return title.length > 35 ? `${title.slice(0, 32)}...` : title;
}

export async function streamOpenCode(
  messages: Message[],
  config: OpenCodeConfig,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const cwd = config.cwd || path.join(os.tmpdir(), "vicinae-opencode");
  try {
    fs.mkdirSync(cwd, { recursive: true });
  } catch {
    // Ignore directory creation errors if already exists
  }

  const args: string[] = ["run", "--format", "json"];

  if (config.sessionId?.trim()) {
    args.push("-s", config.sessionId.trim());
  }

  if (
    config.modelId?.trim() &&
    config.modelId.trim() !== "default" &&
    config.modelId.trim() !== ""
  ) {
    args.push("-m", config.modelId.trim());
  }

  // Build the message prompt
  let prompt = "";
  if (config.sessionId?.trim()) {
    // If continuing an existing OpenCode session, send only the latest message
    prompt = messages[messages.length - 1]?.content || "";
  } else {
    // If no existing OpenCode session, provide conversation history context if multi-turn
    if (messages.length <= 1) {
      prompt = messages[0]?.content || "";
    } else {
      const historyTurns = messages
        .slice(-10, -1)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");
      const latest = messages[messages.length - 1]?.content || "";
      prompt = `Conversation history:\n${historyTurns}\n\nUser: ${latest}`;
    }

    // Safety and behavior instruction without duplication
    const baseInstruction = config.systemPrompt?.trim()
      ? config.systemPrompt.trim()
      : "You are a helpful AI assistant with real-time web access. Format responses cleanly in markdown.";

    const safetyGuard =
      "Do not modify, create, or delete files on the local filesystem unless explicitly requested.";
    const instructionText = baseInstruction.includes("Do not modify")
      ? baseInstruction
      : `${baseInstruction} ${safetyGuard}`;

    prompt = `[Instructions: ${instructionText}]\n\n${prompt}`;
  }

  args.push(prompt);

  return new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("opencode", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        reject(
          new Error(
            "OpenCode CLI is not installed or not found in PATH. Please install opencode to use this provider."
          )
        );
      } else {
        reject(err);
      }
      return;
    }

    if (signal) {
      if (signal.aborted) {
        try {
          child.kill();
        } catch {}
        resolve();
        return;
      }
      const onAbort = () => {
        try {
          child.kill();
        } catch {}
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let lastErrorMessage = "";
    const seenCitations = new Set<string>();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf-8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const evt = JSON.parse(trimmed);

          if (evt.sessionID && config.onSessionId) {
            config.onSessionId(evt.sessionID);
          }

          if (evt.type === "text" && evt.part?.text) {
            onEvent({ type: "token", text: evt.part.text });
          } else if (
            (evt.type === "reasoning" || evt.part?.type === "reasoning") &&
            (evt.part?.text || evt.part?.reasoning)
          ) {
            onEvent({
              type: "reasoning",
              text: evt.part.text || evt.part.reasoning,
            });
          } else if (evt.type === "tool_use" && evt.part) {
            const toolState = evt.part.state;
            const toolTitle = formatToolStatus(evt.part);
            onEvent({ type: "status", message: toolTitle });

            if (typeof toolState?.output === "string") {
              extractCitationsFromOutput(evt.part.tool || "", toolState.output, onEvent, seenCitations);
            }
          } else if (evt.type === "error") {
            const errMsg =
              evt.error?.data?.message ||
              evt.error?.message ||
              JSON.stringify(evt.error);
            lastErrorMessage = errMsg;
            onEvent({ type: "error", error: errMsg });
          }
        } catch {
          // Ignore non-JSON lines
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf-8");
    });

    child.on("error", (err: any) => {
      if (err?.code === "ENOENT") {
        reject(
          new Error(
            "OpenCode CLI is not installed or not found in PATH. Please install opencode to use this provider."
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      // Process any trailing line in buffer
      if (stdoutBuffer.trim()) {
        try {
          const evt = JSON.parse(stdoutBuffer.trim());
          if (evt.sessionID && config.onSessionId) {
            config.onSessionId(evt.sessionID);
          }
          if (evt.type === "text" && evt.part?.text) {
            onEvent({ type: "token", text: evt.part.text });
          }
        } catch {}
      }

      if (code !== 0 && !signal?.aborted) {
        const errorMsg =
          lastErrorMessage ||
          stderrBuffer.trim() ||
          `OpenCode CLI exited with code ${code}`;
        onEvent({ type: "error", error: errorMsg });
        reject(new Error(errorMsg));
      } else {
        onEvent({ type: "done" });
        resolve();
      }
    });
  });
}
