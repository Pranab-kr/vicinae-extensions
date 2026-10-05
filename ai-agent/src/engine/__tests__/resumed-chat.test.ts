import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchAgentChat } from "../client.js";
import { streamOpenRouter } from "../openrouter.js";
import { streamGemini } from "../gemini.js";
import { streamOpenAI } from "../openai.js";
import { streamOpenCode } from "../opencode.js";
import { Conversation, Message, Preferences, StreamEvent } from "../../types.js";
import { saveConversation, loadConversations } from "../../storage/history.js";

vi.mock("../openrouter.js", () => ({ streamOpenRouter: vi.fn() }));
vi.mock("../gemini.js", () => ({ streamGemini: vi.fn() }));
vi.mock("../openai.js", () => ({ streamOpenAI: vi.fn() }));
vi.mock("../opencode.js", () => ({ streamOpenCode: vi.fn() }));

const mockStorage = new Map<string, string>();
vi.mock("@vicinae/api", () => ({
  LocalStorage: {
    getItem: vi.fn(async (key: string) => mockStorage.get(key)),
    setItem: vi.fn(async (key: string, val: string) => {
      mockStorage.set(key, val);
    }),
    removeItem: vi.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    clear: vi.fn(async () => {
      mockStorage.clear();
    }),
  },
}));

describe("resuming conversation with switched provider and model", () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  it("seamlessly switches provider from gemini to opencode and persists updated conversation metadata", async () => {
    // 1. Initial conversation created with Gemini
    const initialConvo: Conversation = {
      id: "convo-100",
      title: "Previous conversation",
      provider: "gemini",
      modelId: "gemini-2.0-flash",
      enableWebSearch: true,
      systemPrompt: "",
      messages: [
        { id: "1", role: "user", content: "Who wrote Python?", timestamp: 100 },
        { id: "2", role: "assistant", content: "Guido van Rossum", timestamp: 101 },
      ],
      createdAt: 100,
      updatedAt: 101,
    };
    await saveConversation(initialConvo);

    // 2. User switched their active preferences to OpenCode CLI
    const currentPrefs: Preferences = {
      provider: "opencode",
      modelId: "opencode/space-bunny-free",
      enableWebSearch: false,
    };

    // 3. User resumes and sends a follow up
    const newMsg: Message = {
      id: "3",
      role: "user",
      content: "When was it released?",
      timestamp: 200,
    };
    const allMessages = [...initialConvo.messages, newMsg];

    let capturedSessionId: string | undefined;
    (streamOpenCode as any).mockImplementation(async (_msgs: any, config: any, onEvent: any) => {
      config.onSessionId?.("ses_opencode_new_789");
      onEvent({ type: "token", text: "In 1991." });
      onEvent({ type: "done" });
    });

    const onEvent = vi.fn();
    await dispatchAgentChat(allMessages, currentPrefs, onEvent, undefined, {
      sessionId: initialConvo.opencodeSessionId,
      onSessionId: (id) => {
        capturedSessionId = id;
      },
    });

    expect(streamOpenCode).toHaveBeenCalledTimes(1);
    expect(streamGemini).not.toHaveBeenCalled();
    expect(capturedSessionId).toBe("ses_opencode_new_789");

    // 4. Save updated conversation with active provider and model
    const assistantMsg: Message = {
      id: "4",
      role: "assistant",
      content: "In 1991.",
      timestamp: 201,
    };

    const updatedConvo: Conversation = {
      ...initialConvo,
      provider: currentPrefs.provider,
      modelId: currentPrefs.modelId,
      opencodeSessionId: capturedSessionId,
      messages: [...allMessages, assistantMsg],
      updatedAt: 201,
    };
    await saveConversation(updatedConvo);

    // Verify stored state in history
    const loaded = await loadConversations();
    expect(loaded[0].id).toBe("convo-100");
    expect(loaded[0].provider).toBe("opencode");
    expect(loaded[0].modelId).toBe("opencode/space-bunny-free");
    expect(loaded[0].opencodeSessionId).toBe("ses_opencode_new_789");
    expect(loaded[0].messages).toHaveLength(4);
  });

  it("seamlessly switches provider from opencode to openrouter with multi-turn context", async () => {
    // 1. Initial conversation created with OpenCode
    const initialConvo: Conversation = {
      id: "convo-200",
      title: "OpenCode Chat",
      provider: "opencode",
      modelId: "opencode/space-bunny-free",
      enableWebSearch: false,
      systemPrompt: "",
      opencodeSessionId: "ses_abc_123",
      messages: [
        { id: "1", role: "user", content: "Tell me about Mars", timestamp: 100 },
        { id: "2", role: "assistant", content: "Mars is the 4th planet", timestamp: 101 },
      ],
      createdAt: 100,
      updatedAt: 101,
    };

    // 2. User changes active preferences to OpenRouter
    const currentPrefs: Preferences = {
      provider: "openrouter",
      modelId: "anthropic/claude-3.7-sonnet",
      openrouterApiKey: "sk-or-valid-key",
      enableWebSearch: true,
    };

    const newMsg: Message = {
      id: "3",
      role: "user",
      content: "How many moons does it have?",
      timestamp: 200,
    };
    const allMessages = [...initialConvo.messages, newMsg];

    (streamOpenRouter as any).mockImplementation(async (_msgs: any, _config: any, onEvent: any) => {
      onEvent({ type: "token", text: "Two moons: Phobos and Deimos." });
      onEvent({ type: "done" });
    });

    const onEvent = vi.fn();
    await dispatchAgentChat(allMessages, currentPrefs, onEvent);

    expect(streamOpenRouter).toHaveBeenCalledTimes(1);
    expect(streamOpenCode).not.toHaveBeenCalled();
    expect(streamOpenRouter).toHaveBeenCalledWith(
      allMessages,
      {
        apiKey: "sk-or-valid-key",
        modelId: "anthropic/claude-3.7-sonnet",
        enableWebSearch: true,
        systemPrompt: undefined,
      },
      onEvent,
      undefined
    );
  });
});
