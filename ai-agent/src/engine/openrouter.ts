import { Message, StreamEvent } from "../types.js";
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
  if (!config.apiKey?.trim()) {
    throw new Error(
      "OpenRouter API key is not configured. Please open extension preferences."
    );
  }

  const payloadMessages: Array<{ role: string; content: string }> = [];
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
      throw new Error(
        `OpenRouter Stream Error: ${
          chunk.error.message || JSON.stringify(chunk.error)
        }`
      );
    }

    const choice = chunk.choices?.[0];
    if (choice) {
      const reasoning =
        choice.delta?.reasoning_content || choice.delta?.reasoning;
      if (reasoning) {
        onEvent({ type: "reasoning", text: reasoning });
      }

      if (choice.delta?.content) {
        onEvent({ type: "token", text: choice.delta.content });
      }
    }

    // Handle citations if annotations are present in chunk
    const citations =
      chunk.annotations?.citations || choice?.delta?.annotations?.citations;
    if (citations && Array.isArray(citations)) {
      for (const c of citations) {
        if (c.url && !citationsSeen.has(c.url)) {
          citationsSeen.add(c.url);
          onEvent({
            type: "citation",
            citation: { title: c.title || c.url, url: c.url },
          });
        }
      }
    }
  }

  onEvent({ type: "done" });
}
