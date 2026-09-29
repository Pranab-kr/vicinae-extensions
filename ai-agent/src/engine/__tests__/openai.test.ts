import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamOpenAI } from "../openai.js";
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

describe("streamOpenAI", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(searchDuckDuckGo).mockResolvedValue([]);
    vi.mocked(safeFetchWebPage).mockResolvedValue({ title: "Page", content: "Content" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("accumulates fragmented tool calls across chunks and streams response", async () => {
    // 1st request returns tool call delta across two chunks
    const toolCallStream = [
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "search_web", "arguments": "{\\"qu"}}]}}]}\n\n',
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "ery\\": \\"linux\\"}"}}]}}]}\n\n',
      'data: {"choices": [{"finish_reason": "tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    // 2nd request returns final text answer
    const answerStream = [
      'data: {"choices": [{"delta": {"content": "Linux is open source."}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    let requestCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      requestCount++;
      const text = requestCount === 1 ? toolCallStream : answerStream;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(text),
      });
    });

    const events: StreamEvent[] = [];
    const messages: Message[] = [
      { id: "1", role: "user", content: "Tell me about linux", timestamp: Date.now() },
    ];

    await streamOpenAI(
      messages,
      {
        apiKey: "sk-test",
        modelId: "gpt-4o-mini",
        enableWebSearch: true,
        baseUrl: "https://api.openai.com/v1",
      },
      (ev) => events.push(ev)
    );

    expect(events).toContainEqual({
      type: "status",
      message: 'Searching web for "linux"...',
    });
    expect(events).toContainEqual({ type: "token", text: "Linux is open source." });
    expect(events).toContainEqual({ type: "done" });
  });

  it("handles direct text response without tools when enableWebSearch is false", async () => {
    const sseResponse = [
      'data: {"choices": [{"delta": {"content": "Hello "}}]}\n\n',
      'data: {"choices": [{"delta": {"content": "world!"}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(sseResponse),
      });
    });

    const events: StreamEvent[] = [];
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await streamOpenAI(
      messages,
      {
        apiKey: "sk-test-key",
        modelId: "gpt-4o",
        enableWebSearch: false,
      },
      (ev) => events.push(ev)
    );

    const parsedBody = JSON.parse(capturedInit?.body as string);
    expect(parsedBody.tools).toBeUndefined();
    expect(parsedBody.tool_choice).toBeUndefined();
    expect(parsedBody.model).toBe("gpt-4o");
    expect(parsedBody.stream).toBe(true);

    expect(events).toEqual([
      { type: "token", text: "Hello " },
      { type: "token", text: "world!" },
      { type: "done" },
    ]);
  });

  it("handles direct text response when tools are enabled but model does not invoke tools", async () => {
    const sseResponse = [
      'data: {"choices": [{"delta": {"content": "2 + 2 = 4"}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    let requestCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      requestCount++;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(sseResponse),
      });
    });

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "What is 2+2?", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(requestCount).toBe(1);
    expect(events).toEqual([
      { type: "token", text: "2 + 2 = 4" },
      { type: "done" },
    ]);
  });

  it("executes search_web tool, emits citations, and supplies results in second turn", async () => {
    const toolCallStream = [
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_search_1", "function": {"name": "search_web", "arguments": "{\\"query\\": \\"vicinae linux\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const answerStream = [
      'data: {"choices": [{"delta": {"content": "Vicinae is an open source launcher."}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const requests: { url: string; body: any }[] = [];
    global.fetch = vi.fn().mockImplementation((url, init) => {
      requests.push({ url: url.toString(), body: JSON.parse(init?.body as string) });
      const text = requests.length === 1 ? toolCallStream : answerStream;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(text),
      });
    });

    vi.mocked(searchDuckDuckGo).mockResolvedValue([
      { title: "Vicinae GitHub", url: "https://github.com/vicinae", snippet: "Repository for Vicinae" },
      { title: "Vicinae Docs", url: "https://vicinae.com/docs", snippet: "Official Documentation" },
    ]);

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "What is Vicinae?", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(searchDuckDuckGo).toHaveBeenCalledWith("vicinae linux", undefined);

    expect(events).toContainEqual({
      type: "status",
      message: 'Searching web for "vicinae linux"...',
    });
    expect(events).toContainEqual({
      type: "citation",
      citation: { title: "Vicinae GitHub", url: "https://github.com/vicinae" },
    });
    expect(events).toContainEqual({
      type: "citation",
      citation: { title: "Vicinae Docs", url: "https://vicinae.com/docs" },
    });
    expect(events).toContainEqual({
      type: "token",
      text: "Vicinae is an open source launcher.",
    });
    expect(events).toContainEqual({ type: "done" });

    // Verify conversation history passed in turn 2
    expect(requests).toHaveLength(2);
    const turn2Messages = requests[1].body.messages;
    expect(turn2Messages).toHaveLength(3); // user + assistant tool call + tool response
    expect(turn2Messages[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_search_1",
          type: "function",
          function: { name: "search_web", arguments: '{"query": "vicinae linux"}' },
        },
      ],
    });
    expect(turn2Messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call_search_1",
      content: JSON.stringify([
        { title: "Vicinae GitHub", url: "https://github.com/vicinae", snippet: "Repository for Vicinae" },
        { title: "Vicinae Docs", url: "https://vicinae.com/docs", snippet: "Official Documentation" },
      ]),
    });
  });

  it("executes fetch_web_page tool, emits citation, and supplies page content in second turn", async () => {
    const toolCallStream = [
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_fetch_1", "function": {"name": "fetch_web_page", "arguments": "{\\"url\\": \\"https://example.com/article\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const answerStream = [
      'data: {"choices": [{"delta": {"content": "Summary of article."}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const requests: { url: string; body: any }[] = [];
    global.fetch = vi.fn().mockImplementation((url, init) => {
      requests.push({ url: url.toString(), body: JSON.parse(init?.body as string) });
      const text = requests.length === 1 ? toolCallStream : answerStream;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(text),
      });
    });

    vi.mocked(safeFetchWebPage).mockResolvedValue({
      title: "Sample Article",
      content: "Detailed contents of the article.",
    });

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "Read https://example.com/article", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(safeFetchWebPage).toHaveBeenCalledWith("https://example.com/article", undefined);

    expect(events).toContainEqual({
      type: "status",
      message: "Reading page https://example.com/article...",
    });
    expect(events).toContainEqual({
      type: "citation",
      citation: { title: "Sample Article", url: "https://example.com/article" },
    });
    expect(events).toContainEqual({ type: "token", text: "Summary of article." });
    expect(events).toContainEqual({ type: "done" });

    // Verify turn 2 tool response message
    const turn2Messages = requests[1].body.messages;
    expect(turn2Messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call_fetch_1",
      content: JSON.stringify({
        title: "Sample Article",
        content: "Detailed contents of the article.",
      }),
    });
  });

  it("handles tool execution errors gracefully and reports failure to model", async () => {
    const toolCallStream = [
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_fail_1", "function": {"name": "search_web", "arguments": "{\\"query\\": \\"fail\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const answerStream = [
      'data: {"choices": [{"delta": {"content": "Could not fetch search results."}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const requests: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      requests.push(JSON.parse(init?.body as string));
      const text = requests.length === 1 ? toolCallStream : answerStream;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(text),
      });
    });

    vi.mocked(searchDuckDuckGo).mockRejectedValue(new Error("Network timeout"));

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "Search fail", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(events).toContainEqual({
      type: "status",
      message: 'Searching web for "fail"...',
    });
    expect(events).toContainEqual({ type: "token", text: "Could not fetch search results." });
    expect(events).toContainEqual({ type: "done" });

    // Verify error message sent as tool result
    const turn2Messages = requests[1].messages;
    expect(turn2Messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call_fail_1",
      content: "Search failed: Network timeout",
    });
  });

  it("handles unknown tool and bad JSON arguments gracefully", async () => {
    const toolCallStream = [
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_bad_1", "function": {"name": "unsupported_tool", "arguments": "{bad-json"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const answerStream = [
      'data: {"choices": [{"delta": {"content": "Handled unknown tool."}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const requests: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      requests.push(JSON.parse(init?.body as string));
      const text = requests.length === 1 ? toolCallStream : answerStream;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(text),
      });
    });

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "Trigger unknown tool", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(events).toContainEqual({ type: "token", text: "Handled unknown tool." });
    expect(events).toContainEqual({ type: "done" });

    const turn2Messages = requests[1].messages;
    expect(turn2Messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call_bad_1",
      content: "Unknown tool",
    });
  });

  it("retries once without tools when model rejects tools with HTTP 400", async () => {
    let callCount = 0;
    const requests: any[] = [];

    global.fetch = vi.fn().mockImplementation((_url, init) => {
      callCount++;
      requests.push(JSON.parse(init?.body as string));
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 400,
          text: vi.fn().mockResolvedValue("Tools not supported for this model"),
        });
      }
      return Promise.resolve({
        ok: true,
        body: createSSEStream('data: {"choices": [{"delta": {"content": "Fallback answer"}}]}\n\ndata: [DONE]\n\n'),
      });
    });

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "Tell me something", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "ollama-model-no-tools",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(callCount).toBe(2);
    expect(events).toContainEqual({
      type: "status",
      message: "Model does not support tools. Continuing without web search...",
    });
    expect(events).toContainEqual({ type: "token", text: "Fallback answer" });
    expect(events).toContainEqual({ type: "done" });

    // First call had tools
    expect(requests[0].tools).toBeDefined();
    // Second call had tools removed
    expect(requests[1].tools).toBeUndefined();
    expect(requests[1].tool_choice).toBeUndefined();
  });

  it("enforces max turns limit and sets tool_choice: 'none' on final turn (turn 4)", async () => {
    const makeToolCallStream = (turnNum: number) => [
      `data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_${turnNum}", "function": {"name": "search_web", "arguments": "{\\"query\\": \\"q${turnNum}\\"}"}}]}}]}\n\n`,
      "data: [DONE]\n\n",
    ].join("");

    const answerStream = [
      'data: {"choices": [{"delta": {"content": "Final synthesized answer."}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const capturedBodies: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedBodies.push(JSON.parse(init?.body as string));
      const turnIndex = capturedBodies.length;
      const text = turnIndex < 4 ? makeToolCallStream(turnIndex) : answerStream;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(text),
      });
    });

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "Perform deep research", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(capturedBodies).toHaveLength(4);
    // Turns 1, 2, 3 should have tools and no tool_choice: "none"
    expect(capturedBodies[0].tools).toBeDefined();
    expect(capturedBodies[0].tool_choice).toBeUndefined();
    expect(capturedBodies[1].tool_choice).toBeUndefined();
    expect(capturedBodies[2].tool_choice).toBeUndefined();

    // Turn 4 (final turn) must have tool_choice: "none"
    expect(capturedBodies[3].tools).toBeDefined();
    expect(capturedBodies[3].tool_choice).toBe("none");

    expect(events).toContainEqual({ type: "token", text: "Final synthesized answer." });
    expect(events).toContainEqual({ type: "done" });
  });

  it("omits Authorization header when apiKey is omitted or empty (for Ollama)", async () => {
    let capturedHeaders: Record<string, string> | undefined;

    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedHeaders = init?.headers;
      return Promise.resolve({
        ok: true,
        body: createSSEStream('data: {"choices": [{"delta": {"content": "Ollama response"}}]}\n\ndata: [DONE]\n\n'),
      });
    });

    await streamOpenAI(
      [{ id: "1", role: "user", content: "Hi local model", timestamp: Date.now() }],
      {
        modelId: "llama3",
        enableWebSearch: false,
        baseUrl: "http://localhost:11434/v1",
      },
      () => {}
    );

    expect(capturedHeaders?.["Content-Type"]).toBe("application/json");
    expect(capturedHeaders?.["Authorization"]).toBeUndefined();
  });

  it("normalizes baseUrl by stripping trailing slashes", async () => {
    let capturedUrl = "";

    global.fetch = vi.fn().mockImplementation((url) => {
      capturedUrl = url.toString();
      return Promise.resolve({
        ok: true,
        body: createSSEStream('data: {"choices": [{"delta": {"content": "ok"}}]}\n\ndata: [DONE]\n\n'),
      });
    });

    await streamOpenAI(
      [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
      {
        modelId: "test-model",
        enableWebSearch: false,
        baseUrl: "https://my-custom-proxy.internal/v1///",
      },
      () => {}
    );

    expect(capturedUrl).toBe("https://my-custom-proxy.internal/v1/chat/completions");
  });

  it("includes systemPrompt and restricts messages to last 10", async () => {
    let capturedBody: any;

    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve({
        ok: true,
        body: createSSEStream("data: [DONE]\n\n"),
      });
    });

    const messages: Message[] = Array.from({ length: 15 }, (_, i) => ({
      id: `${i + 1}`,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Message ${i + 1}`,
      timestamp: Date.now() + i,
    }));

    await streamOpenAI(
      messages,
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: false,
        systemPrompt: "You are a concise expert.",
      },
      () => {}
    );

    // 1 system message + 10 history messages = 11 messages
    expect(capturedBody.messages).toHaveLength(11);
    expect(capturedBody.messages[0]).toEqual({
      role: "system",
      content: "You are a concise expert.",
    });
    expect(capturedBody.messages[1]).toEqual({
      role: "assistant",
      content: "Message 6",
    });
    expect(capturedBody.messages[10]).toEqual({
      role: "user",
      content: "Message 15",
    });
  });

  it("forwards abort signal to fetch and tool execution", async () => {
    let capturedSignal: AbortSignal | undefined;

    const toolCallStream = [
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_abort_1", "function": {"name": "search_web", "arguments": "{\\"query\\": \\"abort test\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedSignal = init?.signal;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(toolCallStream),
      });
    });

    const controller = new AbortController();

    await streamOpenAI(
      [{ id: "1", role: "user", content: "Hi", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: true,
      },
      () => {},
      controller.signal
    );

    expect(capturedSignal).toBe(controller.signal);
    expect(searchDuckDuckGo).toHaveBeenCalledWith("abort test", controller.signal);
  });

  it("throws error on HTTP failure other than 400 with tools", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue("Internal Server Error"),
    });

    await expect(
      streamOpenAI(
        [{ id: "1", role: "user", content: "Hi", timestamp: Date.now() }],
        {
          apiKey: "sk-test",
          modelId: "gpt-4o",
          enableWebSearch: true,
        },
        () => {}
      )
    ).rejects.toThrow("OpenAI API Error (500): Internal Server Error");
  });

  it("throws error when response body is null", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    });

    await expect(
      streamOpenAI(
        [{ id: "1", role: "user", content: "Hi", timestamp: Date.now() }],
        {
          apiKey: "sk-test",
          modelId: "gpt-4o",
          enableWebSearch: false,
        },
        () => {}
      )
    ).rejects.toThrow("No response body received");
  });

  it("throws error on mid-stream error chunk", async () => {
    const sseResponse = [
      'data: {"choices": [{"delta": {"content": "Beginning..."}}]}\n\n',
      'data: {"error": {"message": "Model context window exceeded", "code": 400}}\n\n',
    ].join("");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(sseResponse),
    });

    const events: StreamEvent[] = [];
    await expect(
      streamOpenAI(
        [{ id: "1", role: "user", content: "Hi", timestamp: Date.now() }],
        {
          apiKey: "sk-test",
          modelId: "gpt-4o",
          enableWebSearch: false,
        },
        (ev) => events.push(ev)
      )
    ).rejects.toThrow("Model context window exceeded");

    expect(events).toContainEqual({ type: "token", text: "Beginning..." });
  });

  it("streams reasoning tokens if present in chunk", async () => {
    const sseResponse = [
      'data: {"choices": [{"delta": {"reasoning_content": "Pondering the query..."}}]}\n\n',
      'data: {"choices": [{"delta": {"content": "The answer is 42."}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(sseResponse),
    });

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "Deep thought", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "deepseek-r1",
        enableWebSearch: false,
      },
      (ev) => events.push(ev)
    );

    expect(events).toEqual([
      { type: "reasoning", text: "Pondering the query..." },
      { type: "token", text: "The answer is 42." },
      { type: "done" },
    ]);
  });

  it("deduplicates citations across turns and between search and fetch tools", async () => {
    // Turn 1 returns search_web tool call
    const toolCallStream1 = [
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "search_web", "arguments": "{\\"query\\": \\"test\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    // Turn 2 returns fetch_web_page tool call for same URL
    const toolCallStream2 = [
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_2", "function": {"name": "fetch_web_page", "arguments": "{\\"url\\": \\"https://example.com/page\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    // Turn 3 returns final answer
    const answerStream = [
      'data: {"choices": [{"delta": {"content": "All done."}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    let requestCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      requestCount++;
      const text =
        requestCount === 1
          ? toolCallStream1
          : requestCount === 2
          ? toolCallStream2
          : answerStream;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(text),
      });
    });

    vi.mocked(searchDuckDuckGo).mockResolvedValue([
      { title: "Example Page", url: "https://example.com/page", snippet: "Snippet" },
      { title: "Example Page Duplicate", url: "https://example.com/page", snippet: "Snippet 2" },
    ]);
    vi.mocked(safeFetchWebPage).mockResolvedValue({
      title: "Example Page",
      content: "Fetched content",
    });

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "Check page", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    const citations = events.filter((e) => e.type === "citation");
    expect(citations).toHaveLength(1);
    expect(citations[0]).toEqual({
      type: "citation",
      citation: { title: "Example Page", url: "https://example.com/page" },
    });
  });

  it("guards against null or non-object tool arguments without throwing", async () => {
    const toolCallStream = [
      'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_null_1", "function": {"name": "search_web", "arguments": "null"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const answerStream = [
      'data: {"choices": [{"delta": {"content": "Handled null args."}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    let requestCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      requestCount++;
      return Promise.resolve({
        ok: true,
        body: createSSEStream(requestCount === 1 ? toolCallStream : answerStream),
      });
    });

    const events: StreamEvent[] = [];
    await streamOpenAI(
      [{ id: "1", role: "user", content: "Query", timestamp: Date.now() }],
      {
        apiKey: "sk-test",
        modelId: "gpt-4o",
        enableWebSearch: true,
      },
      (ev) => events.push(ev)
    );

    expect(events).toContainEqual({ type: "token", text: "Handled null args." });
    expect(events).toContainEqual({ type: "done" });
  });
});
