import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamOpenRouter } from "../openrouter.js";
import { Message, StreamEvent } from "../../types.js";

function createSSEStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("streamOpenRouter", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("streams tokens, reasoning, deduplicated citations, and done event", async () => {
    const sseResponse = [
      ": OPENROUTER PROCESSING\n\n",
      'data: {"choices": [{"delta": {"reasoning_content": "Thinking step 1"}}]}\n\n',
      'data: {"choices": [{"delta": {"reasoning_content": "Thinking step 2"}}]}\n\n',
      'data: {"choices": [{"delta": {"content": "Final "}}], "annotations": {"citations": [{"url": "https://example.com/1", "title": "Example 1"}, {"url": "https://example.com/2"}]}}\n\n',
      'data: {"choices": [{"delta": {"content": "answer"}}], "annotations": {"citations": [{"url": "https://example.com/1", "title": "Duplicate URL"}]}}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(sseResponse),
    });

    const events: StreamEvent[] = [];
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await streamOpenRouter(
      messages,
      {
        apiKey: "sk-or-test",
        modelId: "anthropic/claude-3.7-sonnet",
        enableWebSearch: true,
        systemPrompt: "You are helpful",
      },
      (ev) => events.push(ev)
    );

    expect(events).toEqual([
      { type: "reasoning", text: "Thinking step 1" },
      { type: "reasoning", text: "Thinking step 2" },
      { type: "token", text: "Final " },
      {
        type: "citation",
        citation: { title: "Example 1", url: "https://example.com/1" },
      },
      {
        type: "citation",
        citation: {
          title: "https://example.com/2",
          url: "https://example.com/2",
        },
      },
      { type: "token", text: "answer" },
      { type: "done" },
    ]);
  });

  it("throws error when API key is missing or empty or whitespace-only", async () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello", timestamp: Date.now() },
    ];

    await expect(
      streamOpenRouter(
        messages,
        {
          apiKey: "",
          modelId: "test-model",
          enableWebSearch: false,
        },
        () => {}
      )
    ).rejects.toThrow(
      "OpenRouter API key is not configured. Please open extension preferences."
    );

    await expect(
      streamOpenRouter(
        messages,
        {
          apiKey: "   ",
          modelId: "test-model",
          enableWebSearch: false,
        },
        () => {}
      )
    ).rejects.toThrow(
      "OpenRouter API key is not configured. Please open extension preferences."
    );
  });

  it("throws error on HTTP error response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Unauthorized: Invalid API Key"),
    });

    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello", timestamp: Date.now() },
    ];

    await expect(
      streamOpenRouter(
        messages,
        {
          apiKey: "invalid-key",
          modelId: "test-model",
          enableWebSearch: false,
        },
        () => {}
      )
    ).rejects.toThrow("OpenRouter Error (401): Unauthorized: Invalid API Key");
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
      streamOpenRouter(
        messages,
        {
          apiKey: "test-key",
          modelId: "test-model",
          enableWebSearch: false,
        },
        () => {}
      )
    ).rejects.toThrow("No response body received from OpenRouter");
  });

  it("throws error on mid-stream error chunk", async () => {
    const sseResponse = [
      'data: {"choices": [{"delta": {"content": "Starting response"}}]}\n\n',
      'data: {"error": {"message": "Rate limit exceeded", "code": 429}}\n\n',
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
      streamOpenRouter(
        messages,
        {
          apiKey: "test-key",
          modelId: "test-model",
          enableWebSearch: false,
        },
        (ev) => events.push(ev)
      )
    ).rejects.toThrow("OpenRouter Stream Error: Rate limit exceeded");

    expect(events).toContainEqual({
      type: "token",
      text: "Starting response",
    });
  });

  it("sends correct headers, system prompt, sliced messages (last 10), and server tools when enableWebSearch is true", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    global.fetch = vi.fn().mockImplementation((url, init) => {
      capturedUrl = url.toString();
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        body: createSSEStream("data: [DONE]\n\n"),
      });
    });

    // Create 15 messages to test slicing to last 10
    const messages: Message[] = Array.from({ length: 15 }, (_, i) => ({
      id: `${i + 1}`,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Message ${i + 1}`,
      timestamp: Date.now() + i,
    }));

    await streamOpenRouter(
      messages,
      {
        apiKey: "sk-or-real-key",
        modelId: "openai/gpt-4o",
        enableWebSearch: true,
        systemPrompt: "Custom instructions here",
      },
      () => {}
    );

    expect(capturedUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      Authorization: "Bearer sk-or-real-key",
      "HTTP-Referer": "https://vicinae.com",
      "X-Title": "Vicinae AI Agent",
      "Content-Type": "application/json",
    });

    const parsedBody = JSON.parse(capturedInit?.body as string);
    expect(parsedBody.model).toBe("openai/gpt-4o");
    expect(parsedBody.stream).toBe(true);
    expect(parsedBody.tools).toEqual([
      { type: "openrouter:web_search" },
      { type: "openrouter:web_fetch" },
    ]);

    // System prompt + last 10 messages = 11 messages
    expect(parsedBody.messages).toHaveLength(11);
    expect(parsedBody.messages[0]).toEqual({
      role: "system",
      content: "Custom instructions here",
    });
    expect(parsedBody.messages[1]).toEqual({
      role: "assistant",
      content: "Message 6",
    });
    expect(parsedBody.messages[10]).toEqual({
      role: "user",
      content: "Message 15",
    });
  });

  it("omits tools and system message when web search is disabled and system prompt is not provided", async () => {
    let capturedInit: RequestInit | undefined;

    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        body: createSSEStream("data: [DONE]\n\n"),
      });
    });

    const messages: Message[] = [
      { id: "1", role: "user", content: "Query", timestamp: Date.now() },
    ];

    await streamOpenRouter(
      messages,
      {
        apiKey: "sk-or-key",
        modelId: "meta-llama/llama-3.3-70b-instruct",
        enableWebSearch: false,
      },
      () => {}
    );

    const parsedBody = JSON.parse(capturedInit?.body as string);
    expect(parsedBody.tools).toBeUndefined();
    expect(parsedBody.messages).toEqual([{ role: "user", content: "Query" }]);
  });

  it("handles reasoning when provided under reasoning property", async () => {
    const sseResponse = [
      'data: {"choices": [{"delta": {"reasoning": "Reasoning via alternative field"}}]}\n\n',
      'data: {"choices": [{"delta": {"content": "Answer"}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(sseResponse),
    });

    const events: StreamEvent[] = [];
    await streamOpenRouter(
      [{ id: "1", role: "user", content: "Hi", timestamp: Date.now() }],
      {
        apiKey: "sk-or-test",
        modelId: "test-model",
        enableWebSearch: false,
      },
      (ev) => events.push(ev)
    );

    expect(events).toEqual([
      { type: "reasoning", text: "Reasoning via alternative field" },
      { type: "token", text: "Answer" },
      { type: "done" },
    ]);
  });

  it("passes abort signal to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedSignal = init?.signal;
      return Promise.resolve({
        ok: true,
        body: createSSEStream("data: [DONE]\n\n"),
      });
    });

    const controller = new AbortController();
    await streamOpenRouter(
      [{ id: "1", role: "user", content: "Hi", timestamp: Date.now() }],
      {
        apiKey: "sk-or-test",
        modelId: "test-model",
        enableWebSearch: false,
      },
      () => {},
      controller.signal
    );

    expect(capturedSignal).toBe(controller.signal);
  });
});
