import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { Message, StreamEvent } from "../../types.js";
import { streamOpenCode, isOpenCodeAvailable } from "../opencode.js";
import * as childProcess from "child_process";
import * as fs from "fs";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

describe("isOpenCodeAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when opencode --version succeeds", async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();

    (childProcess.spawn as any).mockReturnValue(mockProc);

    const promise = isOpenCodeAvailable();
    mockProc.emit("close", 0);
    const result = await promise;

    expect(result).toBe(true);
    expect(childProcess.spawn).toHaveBeenCalledWith(
      "opencode",
      ["--version"],
      expect.objectContaining({ stdio: "ignore" })
    );
  });

  it("returns false when opencode spawns with error (e.g. ENOENT)", async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();

    (childProcess.spawn as any).mockReturnValue(mockProc);

    const promise = isOpenCodeAvailable();
    const err = new Error("spawn opencode ENOENT");
    (err as any).code = "ENOENT";
    mockProc.emit("error", err);
    const result = await promise;

    expect(result).toBe(false);
  });
});

describe("streamOpenCode", () => {
  const sampleMessages: Message[] = [
    {
      id: "m-1",
      role: "user",
      content: "What is quantum computing?",
      timestamp: 1000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockProcess() {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
  }

  it("streams token events from opencode text output", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const events: StreamEvent[] = [];
    const streamPromise = streamOpenCode(
      sampleMessages,
      { modelId: "opencode/space-bunny-free" },
      (ev) => events.push(ev)
    );

    // Emit json events from stdout
    const line1 = JSON.stringify({
      type: "step_start",
      sessionID: "ses_123",
      part: { type: "step-start" },
    });
    const line2 = JSON.stringify({
      type: "text",
      sessionID: "ses_123",
      part: { type: "text", text: "Quantum computing uses qubits." },
    });
    const line3 = JSON.stringify({
      type: "step_finish",
      sessionID: "ses_123",
      part: { reason: "stop" },
    });

    mockProc.stdout.emit("data", Buffer.from(`${line1}\n${line2}\n${line3}\n`));
    mockProc.emit("close", 0);

    await streamPromise;

    expect(events).toEqual([
      { type: "token", text: "Quantum computing uses qubits." },
      { type: "done" },
    ]);
  });

  it("captures sessionID and notifies via onSessionId", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    let capturedSessionId = "";
    const streamPromise = streamOpenCode(
      sampleMessages,
      {
        onSessionId: (id) => {
          capturedSessionId = id;
        },
      },
      () => {}
    );

    mockProc.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "step_start",
          sessionID: "ses_abc_xyz",
        }) + "\n"
      )
    );
    mockProc.emit("close", 0);

    await streamPromise;

    expect(capturedSessionId).toBe("ses_abc_xyz");
  });

  it("passes -s <sessionId> when sessionId is provided", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const streamPromise = streamOpenCode(
      [
        { id: "1", role: "user", content: "Hi", timestamp: 1 },
        { id: "2", role: "assistant", content: "Hello", timestamp: 2 },
        { id: "3", role: "user", content: "Tell me more", timestamp: 3 },
      ],
      { sessionId: "ses_existing_456" },
      () => {}
    );

    mockProc.emit("close", 0);
    await streamPromise;

    expect(childProcess.spawn).toHaveBeenCalledWith(
      "opencode",
      expect.arrayContaining(["run", "--format", "json", "-s", "ses_existing_456"]),
      expect.anything()
    );
  });

  it("formats conversation history into prompt when no sessionId is provided for multi-turn chat", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const streamPromise = streamOpenCode(
      [
        { id: "1", role: "user", content: "First question", timestamp: 1 },
        { id: "2", role: "assistant", content: "First answer", timestamp: 2 },
        { id: "3", role: "user", content: "Second question", timestamp: 3 },
      ],
      {},
      () => {}
    );

    mockProc.emit("close", 0);
    await streamPromise;

    const spawnCallArgs = (childProcess.spawn as any).mock.calls[0][1];
    const promptArg = spawnCallArgs[spawnCallArgs.length - 1];

    expect(promptArg).toContain("First question");
    expect(promptArg).toContain("First answer");
    expect(promptArg).toContain("Second question");
  });

  it("does not duplicate instruction sentences when systemPrompt is provided", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const streamPromise = streamOpenCode(
      [{ id: "1", role: "user", content: "hello", timestamp: 1 }],
      {
        systemPrompt:
          "You are a helpful AI assistant with real-time web access. Format responses cleanly in markdown.",
      },
      () => {}
    );

    mockProc.emit("close", 0);
    await streamPromise;

    const spawnCallArgs = (childProcess.spawn as any).mock.calls[0][1];
    const promptArg = spawnCallArgs[spawnCallArgs.length - 1];

    const matches = promptArg.match(/You are a helpful AI assistant with real-time web access/g);
    expect(matches).toHaveLength(1);
  });

  it("emits status and citation events on tool_use events (e.g. web search)", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const events: StreamEvent[] = [];
    const streamPromise = streamOpenCode(
      sampleMessages,
      {},
      (ev) => events.push(ev)
    );

    const toolUseLine = JSON.stringify({
      type: "tool_use",
      sessionID: "ses_123",
      part: {
        type: "tool",
        tool: "websearch",
        state: {
          title: "Exa Web Search: Quantum Computing",
          output: "Title: Quantum Overview\nURL: https://example.com/quantum\nHighlights: Intro",
        },
      },
    });

    mockProc.stdout.emit("data", Buffer.from(toolUseLine + "\n"));
    mockProc.emit("close", 0);

    await streamPromise;

    expect(events).toContainEqual({
      type: "status",
      message: "Exa Web Search: Quantum Computing",
    });
    expect(events).toContainEqual({
      type: "citation",
      citation: {
        title: "Quantum Overview",
        url: "https://example.com/quantum",
      },
    });
    expect(events).toContainEqual({ type: "done" });
  });

  it("truncates long bash commands in status messages to prevent bottom UI overlap", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const events: StreamEvent[] = [];
    const streamPromise = streamOpenCode(
      sampleMessages,
      {},
      (ev) => events.push(ev)
    );

    const longBash = "curl -sL https://fmhy.net/ -o /tmp/opencode/fmhy.html; ls -la /tmp/opencode/fmhy.html; grep -o 'open'";
    const toolUseLine = JSON.stringify({
      type: "tool_use",
      sessionID: "ses_123",
      part: {
        type: "tool",
        tool: "bash",
        state: {
          title: longBash,
          input: { command: longBash },
        },
      },
    });

    mockProc.stdout.emit("data", Buffer.from(toolUseLine + "\n"));
    mockProc.emit("close", 0);

    await streamPromise;

    const statusEvent = events.find((e) => e.type === "status") as { type: "status"; message: string };
    expect(statusEvent).toBeDefined();
    expect(statusEvent.message.length).toBeLessThanOrEqual(40);
    expect(statusEvent.message).toContain("Running:");
    expect(statusEvent.message).toContain("...");
  });

  it("uses error message from stdout error event when CLI exits with non-zero code", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const events: StreamEvent[] = [];
    const streamPromise = streamOpenCode(
      sampleMessages,
      {},
      (ev) => events.push(ev)
    );

    const errorEventLine = JSON.stringify({
      type: "error",
      error: {
        name: "UnknownError",
        data: { message: "Model cohere/north-mini-code:free not found or server error" },
      },
    });

    mockProc.stdout.emit("data", Buffer.from(errorEventLine + "\n"));
    mockProc.emit("close", 1);

    await expect(streamPromise).rejects.toThrow("Model cohere/north-mini-code:free not found or server error");
    expect(events).toContainEqual({
      type: "error",
      error: "Model cohere/north-mini-code:free not found or server error",
    });
  });

  it("emits reasoning events when thinking/reasoning blocks are received", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const events: StreamEvent[] = [];
    const streamPromise = streamOpenCode(
      sampleMessages,
      {},
      (ev) => events.push(ev)
    );

    const reasoningLine = JSON.stringify({
      type: "reasoning",
      sessionID: "ses_123",
      part: {
        type: "reasoning",
        text: "Analyzing query requirements...",
      },
    });

    mockProc.stdout.emit("data", Buffer.from(reasoningLine + "\n"));
    mockProc.emit("close", 0);

    await streamPromise;

    expect(events).toContainEqual({
      type: "reasoning",
      text: "Analyzing query requirements...",
    });
  });

  it("handles abort signal by killing the child process", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const controller = new AbortController();
    const streamPromise = streamOpenCode(
      sampleMessages,
      {},
      () => {},
      controller.signal
    );

    controller.abort();

    expect(mockProc.kill).toHaveBeenCalled();
  });

  it("throws clear error when opencode is not found (ENOENT)", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const streamPromise = streamOpenCode(
      sampleMessages,
      {},
      () => {}
    );

    const err = new Error("spawn opencode ENOENT");
    (err as any).code = "ENOENT";
    mockProc.emit("error", err);

    await expect(streamPromise).rejects.toThrow(
      "OpenCode CLI is not installed or not found in PATH"
    );
  });

  it("emits error event and throws if opencode exits with non-zero exit code", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const events: StreamEvent[] = [];
    const streamPromise = streamOpenCode(
      sampleMessages,
      {},
      (ev) => events.push(ev)
    );

    mockProc.stderr.emit("data", Buffer.from("Model error: unknown variant"));
    mockProc.emit("close", 1);

    await expect(streamPromise).rejects.toThrow("Model error: unknown variant");
    expect(events).toContainEqual({
      type: "error",
      error: expect.stringContaining("Model error: unknown variant"),
    });
  });

  it("uses an isolated temporary directory for execution safeguard", async () => {
    const mockProc = createMockProcess();
    (childProcess.spawn as any).mockReturnValue(mockProc);

    const streamPromise = streamOpenCode(sampleMessages, {}, () => {});
    mockProc.emit("close", 0);
    await streamPromise;

    const spawnOptions = (childProcess.spawn as any).mock.calls[0][2];
    expect(spawnOptions.cwd).toBeDefined();
    expect(spawnOptions.cwd).toContain("opencode");
  });
});
