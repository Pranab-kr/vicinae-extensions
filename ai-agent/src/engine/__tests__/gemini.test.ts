import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamGemini } from "../gemini.js";
import { Message, StreamEvent } from "../../types.js";
import { searchDuckDuckGo } from "../tools/ddg.js";
import { safeFetchWebPage } from "../tools/web-fetch.js";

vi.mock("../tools/ddg.js", () => ({
  searchDuckDuckGo: vi.fn(),
}));

vi.mock("../tools/web-fetch.js", () => ({
  safeFetchWebPage: vi.fn(),
}));

function createSSEStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("streamGemini", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends x-goog-api-key header and parses content & grounding chunks", async () => {
    const sseResponse = [
      'data: {"candidates": [{"content": {"parts": [{"text": "Gemini answer"}]}, "groundingMetadata": {"groundingChunks": [{"web": {"title": "Google", "uri": "https://google.com"}}]}}]}\n\n',
    ].join("");

    let capturedHeaders: HeadersInit | undefined;
    let capturedUrl: string = "";

    global.fetch = vi.fn().mockImplementation((url, init) => {
      capturedUrl = url.toString();
      capturedHeaders = init?.headers;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(sseResponse),
      });
    });

    const events: StreamEvent[] = [];
    const messages: Message[] = [
      { id: "1", role: "user", content: "Search test", timestamp: Date.now() },
    ];

    await streamGemini(
      messages,
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-2.0-flash",
        enableWebSearch: true,
        systemPrompt: "Be brief",
      },
      (ev) => events.push(ev)
    );

    // Verify API key is NOT in the URL
    expect(capturedUrl).not.toContain("AIzaSyTestKey");
    // Verify API key IS in header
    expect((capturedHeaders as any)["x-goog-api-key"]).toBe("AIzaSyTestKey");
    expect(events).toContainEqual({ type: "token", text: "Gemini answer" });
    expect(events).toContainEqual({
      type: "citation",
      citation: { title: "Google", url: "https://google.com" },
    });
    expect(events).toContainEqual({ type: "done" });
  });

  it("deduplicates citations by URL from groundingChunks across and within chunks", async () => {
    const sseResponse = [
      'data: {"candidates": [{"content": {"parts": [{"text": "Part 1"}]}, "groundingMetadata": {"groundingChunks": [{"web": {"title": "Doc 1", "uri": "https://example.com/doc"}}, {"web": {"title": "Doc 1 duplicate", "uri": "https://example.com/doc"}}]}}]}\n\n',
      'data: {"candidates": [{"content": {"parts": [{"text": "Part 2"}]}, "groundingMetadata": {"groundingChunks": [{"web": {"uri": "https://example.com/doc"}}, {"web": {"uri": "https://example.com/other"}}]}}]}\n\n',
    ].join("");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(sseResponse),
    });

    const events: StreamEvent[] = [];
    await streamGemini(
      [{ id: "1", role: "user", content: "Hi", timestamp: Date.now() }],
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-2.0-flash",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    const citations = events.filter((e) => e.type === "citation");
    expect(citations).toEqual([
      {
        type: "citation",
        citation: { title: "Doc 1", url: "https://example.com/doc" },
      },
      {
        type: "citation",
        citation: { title: "https://example.com/other", url: "https://example.com/other" },
      },
    ]);
  });

  it("throws error when API key is missing or empty or whitespace-only", async () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello", timestamp: Date.now() },
    ];

    await expect(
      streamGemini(
        messages,
        {
          apiKey: "",
          modelId: "gemini-2.0-flash",
          enableWebSearch: false,
        },
        () => {}
      )
    ).rejects.toThrow("Gemini API key is not configured. Please open extension preferences.");

    await expect(
      streamGemini(
        messages,
        {
          apiKey: "   ",
          modelId: "gemini-2.0-flash",
          enableWebSearch: false,
        },
        () => {}
      )
    ).rejects.toThrow("Gemini API key is not configured. Please open extension preferences.");
  });

  it("throws error on mid-stream error chunk", async () => {
    const sseResponse = [
      'data: {"candidates": [{"content": {"parts": [{"text": "Start"}]}}]}\n\n',
      'data: {"error": {"message": "Resource exhausted", "code": 429}}\n\n',
    ].join("");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(sseResponse),
    });

    const events: StreamEvent[] = [];
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello", timestamp: Date.now() },
    ];

    await expect(
      streamGemini(
        messages,
        {
          apiKey: "AIzaSyTestKey",
          modelId: "gemini-2.0-flash",
          enableWebSearch: false,
        },
        (ev) => events.push(ev)
      )
    ).rejects.toThrow("Gemini Stream Error: Resource exhausted");

    expect(events).toContainEqual({
      type: "token",
      text: "Start",
    });
  });

  it("throws error on HTTP error response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue("API key not valid. Please pass a valid API key."),
    });

    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello", timestamp: Date.now() },
    ];

    await expect(
      streamGemini(
        messages,
        {
          apiKey: "AIzaSyInvalidKey",
          modelId: "gemini-2.0-flash",
          enableWebSearch: false,
        },
        () => {}
      )
    ).rejects.toThrow(
      "Gemini API Error (400): API key not valid. Please pass a valid API key."
    );
  });

  it("throws error when response body is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    });

    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello", timestamp: Date.now() },
    ];

    await expect(
      streamGemini(
        messages,
        {
          apiKey: "AIzaSyTestKey",
          modelId: "gemini-2.0-flash",
          enableWebSearch: false,
        },
        () => {}
      )
    ).rejects.toThrow("No response body received from Gemini");
  });

  it("sanitizes model ID prefix if entered with models/", async () => {
    let capturedUrl = "";
    global.fetch = vi.fn().mockImplementation((url) => {
      capturedUrl = url.toString();
      return Promise.resolve({
        ok: true,
        body: createSSEStream("data: {}\n\n"),
      });
    });

    await streamGemini(
      [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
      {
        apiKey: "AIzaSyTestKey",
        modelId: "models/gemini-2.0-flash",
        enableWebSearch: false,
      },
      () => {}
    );

    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"
    );
  });

  it("maps message roles (assistant -> model, user -> user), slices last 10, and adds systemInstruction", async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        body: createSSEStream("data: {}\n\n"),
      });
    });

    // 15 messages to verify slicing to last 10
    const messages: Message[] = Array.from({ length: 15 }, (_, i) => ({
      id: `${i + 1}`,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Message ${i + 1}`,
      timestamp: Date.now() + i,
    }));

    await streamGemini(
      messages,
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-2.0-flash",
        enableWebSearch: false,
        systemPrompt: "Act as an expert coder",
      },
      () => {}
    );

    const parsedBody = JSON.parse(capturedInit?.body as string);
    expect(parsedBody.systemInstruction).toEqual({
      parts: [{ text: "Act as an expert coder" }],
    });
    expect(parsedBody.contents).toHaveLength(10);
    // Message 6 was assistant (odd index 5) -> role should be "model"
    expect(parsedBody.contents[0]).toEqual({
      role: "model",
      parts: [{ text: "Message 6" }],
    });
    // Message 15 was user (even index 14) -> role should be "user"
    expect(parsedBody.contents[9]).toEqual({
      role: "user",
      parts: [{ text: "Message 15" }],
    });
    expect(parsedBody.tools).toBeUndefined();
  });

  it("configures functionDeclarations tools when enableWebSearch is true", async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        body: createSSEStream("data: {}\n\n"),
      });
    });

    await streamGemini(
      [{ id: "1", role: "user", content: "Search", timestamp: Date.now() }],
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-3.5-flash",
        enableWebSearch: true,
      },
      () => {}
    );

    const parsedBody = JSON.parse(capturedInit?.body as string);
    expect(parsedBody.tools).toEqual([
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
    ]);
  });

  it("executes search_web functionCall and continues stream turn with functionResponse", async () => {
    vi.mocked(searchDuckDuckGo).mockResolvedValueOnce([
      { title: "Vicinae News", url: "https://vicinae.com/news", snippet: "Latest news" },
    ]);

    const turn1SSE =
      'data: {"candidates": [{"content": {"role": "model", "parts": [{"functionCall": {"name": "search_web", "args": {"query": "vicinae"}, "id": "call_1"}, "thoughtSignature": "sig123"}]}}]}\n\n';
    const turn2SSE =
      'data: {"candidates": [{"content": {"role": "model", "parts": [{"text": "Found Vicinae news."}]}}]}\n\n';

    const capturedInits: RequestInit[] = [];
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedInits.push(init);
      if (capturedInits.length === 1) {
        return Promise.resolve({ ok: true, body: createSSEStream(turn1SSE) });
      }
      return Promise.resolve({ ok: true, body: createSSEStream(turn2SSE) });
    });

    const events: StreamEvent[] = [];
    await streamGemini(
      [{ id: "1", role: "user", content: "Search for vicinae", timestamp: Date.now() }],
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-3.5-flash",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(searchDuckDuckGo).toHaveBeenCalledWith("vicinae", undefined);
    expect(events).toContainEqual({
      type: "status",
      message: 'Searching web for "vicinae"...',
    });
    expect(events).toContainEqual({
      type: "citation",
      citation: { title: "Vicinae News", url: "https://vicinae.com/news" },
    });
    expect(events).toContainEqual({
      type: "token",
      text: "Found Vicinae news.",
    });
    expect(events).toContainEqual({ type: "done" });

    // Verify Turn 2 request body had functionResponse and preserved thoughtSignature
    expect(capturedInits).toHaveLength(2);
    const turn2Body = JSON.parse(capturedInits[1].body as string);
    expect(turn2Body.contents).toHaveLength(3);
    // Model turn contains the functionCall part with its thoughtSignature
    expect(turn2Body.contents[1]).toEqual({
      role: "model",
      parts: [
        {
          functionCall: { name: "search_web", args: { query: "vicinae" }, id: "call_1" },
          thoughtSignature: "sig123",
        },
      ],
    });
    // User/function turn contains functionResponse
    expect(turn2Body.contents[2].role).toBe("user");
    expect(turn2Body.contents[2].parts[0].functionResponse.name).toBe("search_web");
    expect(turn2Body.contents[2].parts[0].functionResponse.id).toBe("call_1");
  });

  it("executes fetch_web_page functionCall and continues stream turn with functionResponse", async () => {
    vi.mocked(safeFetchWebPage).mockResolvedValueOnce({
      title: "Example Title",
      content: "Clean extracted page content",
    });

    const turn1SSE =
      'data: {"candidates": [{"content": {"role": "model", "parts": [{"functionCall": {"name": "fetch_web_page", "args": {"url": "https://example.com/page"}}, "thoughtSignature": "sig456"}]}}]}\n\n';
    const turn2SSE =
      'data: {"candidates": [{"content": {"role": "model", "parts": [{"text": "Page content summary."}]}}]}\n\n';

    const capturedInits: RequestInit[] = [];
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedInits.push(init);
      if (capturedInits.length === 1) {
        return Promise.resolve({ ok: true, body: createSSEStream(turn1SSE) });
      }
      return Promise.resolve({ ok: true, body: createSSEStream(turn2SSE) });
    });

    const events: StreamEvent[] = [];
    await streamGemini(
      [{ id: "1", role: "user", content: "Read https://example.com/page", timestamp: Date.now() }],
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-3.5-flash",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(safeFetchWebPage).toHaveBeenCalledWith("https://example.com/page", undefined);
    expect(events).toContainEqual({
      type: "status",
      message: "Reading page https://example.com/page...",
    });
    expect(events).toContainEqual({
      type: "citation",
      citation: { title: "Example Title", url: "https://example.com/page" },
    });
    expect(events).toContainEqual({
      type: "token",
      text: "Page content summary.",
    });
    expect(events).toContainEqual({ type: "done" });
  });

  it("retries without tools when model rejects tools with 400 status", async () => {
    let callCount = 0;
    const capturedInits: RequestInit[] = [];

    global.fetch = vi.fn().mockImplementation((_url, init) => {
      callCount++;
      capturedInits.push(init);
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 400,
          text: vi.fn().mockResolvedValue("Tool use not supported for this model"),
        });
      }
      return Promise.resolve({
        ok: true,
        body: createSSEStream(
          'data: {"candidates": [{"content": {"parts": [{"text": "Fallback answer"}]}}]}\n\n'
        ),
      });
    });

    const events: StreamEvent[] = [];
    await streamGemini(
      [{ id: "1", role: "user", content: "Hello", timestamp: Date.now() }],
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-3.5-flash",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(callCount).toBe(2);
    expect(events).toContainEqual({
      type: "status",
      message: "Model does not support tools. Continuing without web search...",
    });
    expect(events).toContainEqual({
      type: "token",
      text: "Fallback answer",
    });

    // Check first call had tools, second call did not
    const firstBody = JSON.parse(capturedInits[0].body as string);
    const secondBody = JSON.parse(capturedInits[1].body as string);
    expect(firstBody.tools).toBeDefined();
    expect(secondBody.tools).toBeUndefined();
  });

  it("forwards abort signal to fetch and SSE parser", async () => {
    let capturedSignal: AbortSignal | undefined;
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedSignal = init?.signal;
      return Promise.resolve({
        ok: true,
        body: createSSEStream("data: {}\n\n"),
      });
    });

    const controller = new AbortController();
    await streamGemini(
      [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-2.0-flash",
        enableWebSearch: false,
      },
      () => {},
      controller.signal
    );

    expect(capturedSignal).toBe(controller.signal);
  });
});
