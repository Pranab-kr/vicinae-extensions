import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchAgentChat } from "../client.js";
import { streamOpenRouter } from "../openrouter.js";
import { streamGemini } from "../gemini.js";
import { streamOpenAI } from "../openai.js";
import { Message, Preferences, StreamEvent } from "../../types.js";

vi.mock("../openrouter.js", () => ({
  streamOpenRouter: vi.fn(),
}));

vi.mock("../gemini.js", () => ({
  streamGemini: vi.fn(),
}));

vi.mock("../openai.js", () => ({
  streamOpenAI: vi.fn(),
}));

describe("dispatchAgentChat", () => {
  const sampleMessages: Message[] = [
    {
      id: "m-1",
      role: "user",
      content: "Hello AI",
      timestamp: 1000,
    },
  ];

  const onEvent = vi.fn((ev: StreamEvent) => {});
  const abortController = new AbortController();
  const signal = abortController.signal;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes to streamOpenRouter when provider is 'openrouter'", async () => {
    const prefs: Preferences = {
      provider: "openrouter",
      modelId: "anthropic/claude-3.7-sonnet",
      openrouterApiKey: "sk-or-test-key",
      enableWebSearch: true,
      systemPrompt: "You are an assistant",
    };

    await dispatchAgentChat(sampleMessages, prefs, onEvent, signal);

    expect(streamOpenRouter).toHaveBeenCalledTimes(1);
    expect(streamOpenRouter).toHaveBeenCalledWith(
      sampleMessages,
      {
        apiKey: "sk-or-test-key",
        modelId: "anthropic/claude-3.7-sonnet",
        enableWebSearch: true,
        systemPrompt: "You are an assistant",
      },
      onEvent,
      signal
    );
    expect(streamGemini).not.toHaveBeenCalled();
    expect(streamOpenAI).not.toHaveBeenCalled();
  });

  it("routes to streamOpenRouter with empty apiKey if openrouterApiKey is missing", async () => {
    const prefs: Preferences = {
      provider: "openrouter",
      modelId: "anthropic/claude-3.7-sonnet",
      enableWebSearch: false,
    };

    await dispatchAgentChat(sampleMessages, prefs, onEvent);

    expect(streamOpenRouter).toHaveBeenCalledWith(
      sampleMessages,
      {
        apiKey: "",
        modelId: "anthropic/claude-3.7-sonnet",
        enableWebSearch: false,
        systemPrompt: undefined,
      },
      onEvent,
      undefined
    );
  });

  it("routes to streamGemini when provider is 'gemini'", async () => {
    const prefs: Preferences = {
      provider: "gemini",
      modelId: "gemini-2.0-flash",
      geminiApiKey: "AIzaSyTestKey",
      enableWebSearch: true,
      systemPrompt: "You are Gemini",
    };

    await dispatchAgentChat(sampleMessages, prefs, onEvent, signal);

    expect(streamGemini).toHaveBeenCalledTimes(1);
    expect(streamGemini).toHaveBeenCalledWith(
      sampleMessages,
      {
        apiKey: "AIzaSyTestKey",
        modelId: "gemini-2.0-flash",
        enableWebSearch: true,
        systemPrompt: "You are Gemini",
      },
      onEvent,
      signal
    );
    expect(streamOpenRouter).not.toHaveBeenCalled();
    expect(streamOpenAI).not.toHaveBeenCalled();
  });

  it("routes to streamGemini with empty apiKey if geminiApiKey is missing", async () => {
    const prefs: Preferences = {
      provider: "gemini",
      modelId: "gemini-2.0-flash",
      enableWebSearch: false,
    };

    await dispatchAgentChat(sampleMessages, prefs, onEvent);

    expect(streamGemini).toHaveBeenCalledWith(
      sampleMessages,
      {
        apiKey: "",
        modelId: "gemini-2.0-flash",
        enableWebSearch: false,
        systemPrompt: undefined,
      },
      onEvent,
      undefined
    );
  });

  it("routes to streamOpenAI when provider is 'openai'", async () => {
    const prefs: Preferences = {
      provider: "openai",
      modelId: "gpt-4o",
      openaiApiKey: "sk-proj-test",
      enableWebSearch: true,
      systemPrompt: "You are OpenAI",
    };

    await dispatchAgentChat(sampleMessages, prefs, onEvent, signal);

    expect(streamOpenAI).toHaveBeenCalledTimes(1);
    expect(streamOpenAI).toHaveBeenCalledWith(
      sampleMessages,
      {
        apiKey: "sk-proj-test",
        modelId: "gpt-4o",
        baseUrl: "https://api.openai.com/v1",
        enableWebSearch: true,
        systemPrompt: "You are OpenAI",
      },
      onEvent,
      signal
    );
    expect(streamOpenRouter).not.toHaveBeenCalled();
    expect(streamGemini).not.toHaveBeenCalled();
  });

  it("routes to streamOpenAI when provider is 'ollama_custom' with customBaseUrl", async () => {
    const prefs: Preferences = {
      provider: "ollama_custom",
      modelId: "llama3.3:70b",
      openaiApiKey: "local-key",
      customBaseUrl: "http://192.168.1.100:11434/v1",
      enableWebSearch: false,
      systemPrompt: "You are Local Llama",
    };

    await dispatchAgentChat(sampleMessages, prefs, onEvent, signal);

    expect(streamOpenAI).toHaveBeenCalledTimes(1);
    expect(streamOpenAI).toHaveBeenCalledWith(
      sampleMessages,
      {
        apiKey: "local-key",
        modelId: "llama3.3:70b",
        baseUrl: "http://192.168.1.100:11434/v1",
        enableWebSearch: false,
        systemPrompt: "You are Local Llama",
      },
      onEvent,
      signal
    );
  });

  it("routes to streamOpenAI when provider is 'ollama_custom' defaulting to localhost URL if customBaseUrl is empty", async () => {
    const prefs: Preferences = {
      provider: "ollama_custom",
      modelId: "deepseek-r1:14b",
      openaiApiKey: "",
      customBaseUrl: "",
      enableWebSearch: true,
    };

    await dispatchAgentChat(sampleMessages, prefs, onEvent);

    expect(streamOpenAI).toHaveBeenCalledWith(
      sampleMessages,
      {
        apiKey: "",
        modelId: "deepseek-r1:14b",
        baseUrl: "http://localhost:11434/v1",
        enableWebSearch: true,
        systemPrompt: undefined,
      },
      onEvent,
      undefined
    );
  });

  it("throws an error when an unsupported provider is specified", async () => {
    const prefs = {
      provider: "unsupported_llm",
      modelId: "test",
      enableWebSearch: false,
    } as unknown as Preferences;

    await expect(dispatchAgentChat(sampleMessages, prefs, onEvent)).rejects.toThrow(
      "Unsupported provider: unsupported_llm"
    );
  });
});
