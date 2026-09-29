import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamGemini } from "../gemini.js";
import { Message, StreamEvent } from "../../types.js";

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

  it("configures googleSearch tool when enableWebSearch is true", async () => {
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
        modelId: "gemini-2.0-flash",
        enableWebSearch: true,
      },
      () => {}
    );

    const parsedBody = JSON.parse(capturedInit?.body as string);
    expect(parsedBody.tools).toEqual([{ googleSearch: {} }]);
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
