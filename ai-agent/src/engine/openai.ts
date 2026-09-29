import { Message, StreamEvent } from "../types.js";
import { parseSSEStream } from "./sse.js";
import { searchDuckDuckGo } from "./tools/ddg.js";
import { safeFetchWebPage } from "./tools/web-fetch.js";

export interface OpenAIConfig {
  apiKey?: string;
  modelId: string;
  baseUrl?: string;
  enableWebSearch: boolean;
  systemPrompt?: string;
}

const TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for up-to-date real-time information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_web_page",
      description: "Fetch and read clean text content from a web URL",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full http/https URL to read" },
        },
        required: ["url"],
      },
    },
  },
];

export async function streamOpenAI(
  messages: Message[],
  config: OpenAIConfig,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;

  const conversationHistory: any[] = [];
  if (config.systemPrompt) {
    conversationHistory.push({ role: "system", content: config.systemPrompt });
  }

  for (const m of messages.slice(-10)) {
    conversationHistory.push({ role: m.role, content: m.content });
  }

  let turn = 0;
  const maxTurns = 4;
  let useTools = config.enableWebSearch;

  while (turn < maxTurns) {
    turn++;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const isFinalTurn = turn >= maxTurns;
    const bodyPayload: any = {
      model: config.modelId,
      messages: conversationHistory,
      stream: true,
    };

    if (useTools) {
      bodyPayload.tools = TOOLS_SCHEMA;
      if (isFinalTurn) {
        bodyPayload.tool_choice = "none";
      }
    }

    let resp = await fetch(endpoint, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(bodyPayload),
    });

    // Fallback: If model rejects tools (400), retry once without tools
    if (!resp.ok && useTools && resp.status === 400) {
      onEvent({
        type: "status",
        message: "Model does not support tools. Continuing without web search...",
      });
      useTools = false;
      delete bodyPayload.tools;
      delete bodyPayload.tool_choice;
      resp = await fetch(endpoint, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify(bodyPayload),
      });
    }

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`OpenAI API Error (${resp.status}): ${err}`);
    }

    if (!resp.body) {
      throw new Error("No response body received");
    }

    // Accumulate tool calls and text
    const toolCallsBuffer: Record<number, { id: string; name: string; arguments: string }> = {};
    let assistantText = "";

    for await (const chunk of parseSSEStream(resp.body, signal)) {
      if (chunk.error) {
        throw new Error(chunk.error.message || JSON.stringify(chunk.error));
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const reasoning = choice.delta?.reasoning_content || choice.delta?.reasoning;
      if (reasoning) {
        onEvent({ type: "reasoning", text: reasoning });
      }

      if (choice.delta?.content) {
        assistantText += choice.delta.content;
        onEvent({ type: "token", text: choice.delta.content });
      }

      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsBuffer[idx]) {
            toolCallsBuffer[idx] = { id: tc.id || "", name: tc.function?.name || "", arguments: "" };
          }
          if (tc.id) toolCallsBuffer[idx].id = tc.id;
          if (tc.function?.name) toolCallsBuffer[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallsBuffer[idx].arguments += tc.function.arguments;
        }
      }
    }

    const executedTools = Object.values(toolCallsBuffer);
    if (executedTools.length === 0) {
      // Completed normal text generation
      onEvent({ type: "done" });
      return;
    }

    // Append assistant tool calls message to conversation history
    conversationHistory.push({
      role: "assistant",
      content: assistantText || null,
      tool_calls: executedTools.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.arguments },
      })),
    });

    // Execute each tool call
    for (const tool of executedTools) {
      let args: any = {};
      try {
        args = JSON.parse(tool.arguments);
      } catch {
        // Bad JSON arguments from model
      }

      let toolResult = "";
      if (tool.name === "search_web") {
        onEvent({ type: "status", message: `Searching web for "${args.query || ""}"...` });
        try {
          const results = await searchDuckDuckGo(args.query || "", signal);
          toolResult = JSON.stringify(results);
          for (const r of results) {
            onEvent({ type: "citation", citation: { title: r.title, url: r.url } });
          }
        } catch (err: any) {
          toolResult = `Search failed: ${err.message}`;
        }
      } else if (tool.name === "fetch_web_page") {
        onEvent({ type: "status", message: `Reading page ${args.url || ""}...` });
        try {
          const page = await safeFetchWebPage(args.url || "", signal);
          toolResult = JSON.stringify(page);
          onEvent({ type: "citation", citation: { title: page.title, url: args.url || "" } });
        } catch (err: any) {
          toolResult = `Fetch failed: ${err.message}`;
        }
      } else {
        toolResult = "Unknown tool";
      }

      conversationHistory.push({
        role: "tool",
        tool_call_id: tool.id,
        content: toolResult,
      });
    }
  }

  onEvent({ type: "done" });
}
