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
