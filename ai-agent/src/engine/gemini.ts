import { Message, StreamEvent } from "../types.js";
import { parseSSEStream } from "./sse.js";
import { searchDuckDuckGo } from "./tools/ddg.js";
import { safeFetchWebPage } from "./tools/web-fetch.js";

export interface GeminiConfig {
  apiKey: string;
  modelId: string;
  enableWebSearch: boolean;
  systemPrompt?: string;
}

const GEMINI_TOOLS_SCHEMA = [
  {
    functionDeclarations: [
      {
        name: "search_web",
        description: "Search the web for up-to-date real-time information",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "fetch_web_page",
        description: "Fetch and read clean text content from a web URL",
        parameters: {
          type: "OBJECT",
          properties: {
            url: { type: "STRING", description: "The full http/https URL to read" },
          },
          required: ["url"],
        },
      },
    ],
  },
];

export async function streamGemini(
  messages: Message[],
  config: GeminiConfig,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!config.apiKey?.trim()) {
    throw new Error("Gemini API key is not configured. Please open extension preferences.");
  }

  // Model ID mapping: sanitize prefix if entered with models/
  const cleanModel = config.modelId.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse`;

  const contents: any[] = messages.slice(-10).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  let turn = 0;
  const maxTurns = 4;
  let useTools = config.enableWebSearch;
  const seenUrls = new Set<string>();

  while (turn < maxTurns) {
    turn++;
    const isFinalTurn = turn >= maxTurns;

    const body: any = { contents };

    if (config.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: config.systemPrompt }],
      };
    }

    if (useTools && !isFinalTurn) {
      body.tools = GEMINI_TOOLS_SCHEMA;
    }

    let resp = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify(body),
    });

    // Fallback: If model rejects tools (400), retry once without tools
    if (!resp.ok && useTools && resp.status === 400) {
      onEvent({
        type: "status",
        message: "Model does not support tools. Continuing without web search...",
      });
      useTools = false;
      delete body.tools;
      resp = await fetch(url, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
      });
    }

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Gemini API Error (${resp.status}): ${errorText}`);
    }

    if (!resp.body) {
      throw new Error("No response body received from Gemini");
    }

    const accumulatedModelParts: any[] = [];
    const functionCalls: Array<{ name: string; args: any; id?: string }> = [];

    for await (const chunk of parseSSEStream(resp.body, signal)) {
      if (chunk.error) {
        throw new Error(`Gemini Stream Error: ${chunk.error.message || JSON.stringify(chunk.error)}`);
      }

      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;

      const parts = candidate.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          accumulatedModelParts.push(part);

          if (part.text) {
            onEvent({ type: "token", text: part.text });
          }

          if (part.functionCall) {
            functionCalls.push({
              name: part.functionCall.name,
              args: part.functionCall.args || {},
              id: part.functionCall.id,
            });
          }
        }
      }

      // Backward compatibility: parse groundingChunks if present
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

    if (functionCalls.length === 0) {
      // Completed text generation without further function calls
      onEvent({ type: "done" });
      return;
    }

    // Append model's response (preserving functionCall and thoughtSignature) to conversation
    contents.push({
      role: "model",
      parts: accumulatedModelParts,
    });

    // Execute each function call
    const functionResponseParts: any[] = [];
    for (const tool of functionCalls) {
      const args = tool.args || {};
      let resultData: any;

      if (tool.name === "search_web") {
        const query = typeof args.query === "string" ? args.query : "";
        onEvent({ type: "status", message: `Searching web for "${query}"...` });
        try {
          const results = await searchDuckDuckGo(query, signal);
          resultData = results;
          for (const r of results) {
            if (r.url && !seenUrls.has(r.url)) {
              seenUrls.add(r.url);
              onEvent({ type: "citation", citation: { title: r.title, url: r.url } });
            }
          }
        } catch (err: any) {
          resultData = { error: `Search failed: ${err.message}` };
        }
      } else if (tool.name === "fetch_web_page") {
        const pageUrl = typeof args.url === "string" ? args.url : "";
        onEvent({ type: "status", message: `Reading page ${pageUrl}...` });
        try {
          const page = await safeFetchWebPage(pageUrl, signal);
          resultData = page;
          if (pageUrl && !seenUrls.has(pageUrl)) {
            seenUrls.add(pageUrl);
            onEvent({ type: "citation", citation: { title: page.title, url: pageUrl } });
          }
        } catch (err: any) {
          resultData = { error: `Fetch failed: ${err.message}` };
        }
      } else {
        resultData = { error: `Unknown tool: ${tool.name}` };
      }

      const responseStruct =
        typeof resultData === "object" && resultData !== null && !Array.isArray(resultData)
          ? resultData
          : { result: resultData };

      const funcResponseObj: any = {
        name: tool.name,
        response: responseStruct,
      };
      if (tool.id) {
        funcResponseObj.id = tool.id;
      }

      functionResponseParts.push({
        functionResponse: funcResponseObj,
      });
    }

    contents.push({
      role: "user",
      parts: functionResponseParts,
    });
  }

  onEvent({ type: "done" });
}
