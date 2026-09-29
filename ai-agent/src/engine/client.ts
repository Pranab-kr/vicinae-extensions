import { Message, Preferences, StreamEvent } from "../types.js";
import { streamOpenRouter } from "./openrouter.js";
import { streamGemini } from "./gemini.js";
import { streamOpenAI } from "./openai.js";

export async function dispatchAgentChat(
  messages: Message[],
  prefs: Preferences,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  switch (prefs.provider) {
    case "openrouter":
      return streamOpenRouter(
        messages,
        {
          apiKey: prefs.openrouterApiKey || "",
          modelId: prefs.modelId,
          enableWebSearch: prefs.enableWebSearch,
          systemPrompt: prefs.systemPrompt,
        },
        onEvent,
        signal
      );
    case "gemini":
      return streamGemini(
        messages,
        {
          apiKey: prefs.geminiApiKey || "",
          modelId: prefs.modelId,
          enableWebSearch: prefs.enableWebSearch,
          systemPrompt: prefs.systemPrompt,
        },
        onEvent,
        signal
      );
    case "openai":
      return streamOpenAI(
        messages,
        {
          apiKey: prefs.openaiApiKey || "",
          modelId: prefs.modelId,
          baseUrl: "https://api.openai.com/v1",
          enableWebSearch: prefs.enableWebSearch,
          systemPrompt: prefs.systemPrompt,
        },
        onEvent,
        signal
      );
    case "ollama_custom":
      return streamOpenAI(
        messages,
        {
          apiKey: prefs.openaiApiKey || "",
          modelId: prefs.modelId,
          baseUrl: prefs.customBaseUrl || "http://localhost:11434/v1",
          enableWebSearch: prefs.enableWebSearch,
          systemPrompt: prefs.systemPrompt,
        },
        onEvent,
        signal
      );
    default:
      throw new Error(`Unsupported provider: ${(prefs as any).provider}`);
  }
}
