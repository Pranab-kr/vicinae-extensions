import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateConversationTitle,
  loadConversations,
  saveConversation,
  deleteConversation,
  clearConversations,
  renameConversation,
} from "../history.js";
import { Conversation } from "../../types.js";
import { LocalStorage } from "@vicinae/api";

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

function createMockConversation(id: string, title = "Test Conversation"): Conversation {
  return {
    id,
    title,
    provider: "openrouter",
    modelId: "anthropic/claude-3.7-sonnet",
    enableWebSearch: true,
    systemPrompt: "You are a helpful assistant.",
    messages: [
      {
        id: `msg-${id}-1`,
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("generateConversationTitle", () => {
  it("generates a clean title truncated at 40 chars with ellipsis", () => {
    const title = generateConversationTitle(
      "What are the key architectural improvements in the Linux kernel 6.14 release?"
    );
    expect(title.length).toBeLessThanOrEqual(43);
    expect(title).toBe("What are the key architectural improveme...");
  });

  it("handles short prompts without ellipsis", () => {
    const title = generateConversationTitle("Hello world");
    expect(title).toBe("Hello world");
  });

  it("handles exact 40 char prompts without ellipsis", () => {
    const exact40 = "1234567890123456789012345678901234567890";
    const title = generateConversationTitle(exact40);
    expect(title).toBe(exact40);
    expect(title.length).toBe(40);
  });

  it("normalizes newlines, carriage returns, tabs, and multiple spaces", () => {
    const multiline = "   What  is   quantum\r\ncomputing?\n\nExplain\tit.   ";
    const title = generateConversationTitle(multiline);
    expect(title).toBe("What is quantum computing? Explain it.");
  });

  it("normalizes whitespace before truncating long prompts", () => {
    const longPromptWithSpaces =
      "  Explain   in   depth\n\rhow   distributed   systems   achieve   consensus   using   Raft   ";
    const title = generateConversationTitle(longPromptWithSpaces);
    expect(title).toBe("Explain in depth how distributed systems...");
  });
});

describe("history storage layer", () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  describe("loadConversations", () => {
    it("returns empty array when storage is empty", async () => {
      const list = await loadConversations();
      expect(list).toEqual([]);
      expect(LocalStorage.getItem).toHaveBeenCalledWith("vicinae_ai_agent_conversations_v1");
    });

    it("returns parsed conversations array when storage has data", async () => {
      const convos = [createMockConversation("c-1"), createMockConversation("c-2")];
      mockStorage.set("vicinae_ai_agent_conversations_v1", JSON.stringify(convos));

      const list = await loadConversations();
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe("c-1");
      expect(list[1].id).toBe("c-2");
    });

    it("returns empty array gracefully on corrupt JSON", async () => {
      mockStorage.set("vicinae_ai_agent_conversations_v1", "{corrupted-json-data");

      const list = await loadConversations();
      expect(list).toEqual([]);
    });

    it("returns empty array gracefully when stored JSON is not an array", async () => {
      mockStorage.set("vicinae_ai_agent_conversations_v1", JSON.stringify({ notAnArray: true }));

      const list = await loadConversations();
      expect(list).toEqual([]);
    });

    it("returns empty array gracefully when LocalStorage throws", async () => {
      vi.mocked(LocalStorage.getItem).mockRejectedValueOnce(new Error("Storage I/O failure"));

      const list = await loadConversations();
      expect(list).toEqual([]);
    });
  });

  describe("saveConversation", () => {
    it("prepends a new conversation to history and saves to storage", async () => {
      const convo1 = createMockConversation("c-1", "First convo");
      await saveConversation(convo1);

      expect(LocalStorage.setItem).toHaveBeenCalledWith(
        "vicinae_ai_agent_conversations_v1",
        JSON.stringify([convo1])
      );

      const convo2 = createMockConversation("c-2", "Second convo");
      await saveConversation(convo2);

      const stored = JSON.parse(mockStorage.get("vicinae_ai_agent_conversations_v1")!);
      expect(stored).toHaveLength(2);
      expect(stored[0].id).toBe("c-2");
      expect(stored[1].id).toBe("c-1");
    });

    it("moves updated existing conversation to the top (MRU order)", async () => {
      const convo1 = createMockConversation("c-1", "Initial title");
      const convo2 = createMockConversation("c-2", "Other convo");
      mockStorage.set(
        "vicinae_ai_agent_conversations_v1",
        JSON.stringify([convo1, convo2])
      );

      const updated2: Conversation = {
        ...convo2,
        title: "Updated title",
        updatedAt: Date.now() + 5000,
      };

      await saveConversation(updated2);

      const stored = JSON.parse(mockStorage.get("vicinae_ai_agent_conversations_v1")!);
      expect(stored).toHaveLength(2);
      expect(stored[0].id).toBe("c-2");
      expect(stored[0].title).toBe("Updated title");
      expect(stored[1].id).toBe("c-1");
    });

    it("caps conversation list at 50 items, keeping the most recent", async () => {
      const initialConvos: Conversation[] = [];
      for (let i = 1; i <= 50; i++) {
        initialConvos.push(createMockConversation(`c-${i}`, `Convo ${i}`));
      }
      mockStorage.set(
        "vicinae_ai_agent_conversations_v1",
        JSON.stringify(initialConvos)
      );

      const newConvo = createMockConversation("c-new", "Brand new convo");
      await saveConversation(newConvo);

      const stored = JSON.parse(mockStorage.get("vicinae_ai_agent_conversations_v1")!);
      expect(stored).toHaveLength(50);
      expect(stored[0].id).toBe("c-new");
      expect(stored[1].id).toBe("c-1");
      expect(stored[49].id).toBe("c-49");
      // The 50th from initial (c-50) is dropped
      expect(stored.find((c: Conversation) => c.id === "c-50")).toBeUndefined();
    });

    it("persists opencode provider and opencodeSessionId", async () => {
      const opencodeConvo: Conversation = {
        ...createMockConversation("c-opencode"),
        provider: "opencode",
        modelId: "opencode/space-bunny-free",
        opencodeSessionId: "ses_test_12345",
      };

      await saveConversation(opencodeConvo);

      const stored = JSON.parse(mockStorage.get("vicinae_ai_agent_conversations_v1")!);
      expect(stored[0].provider).toBe("opencode");
      expect(stored[0].modelId).toBe("opencode/space-bunny-free");
      expect(stored[0].opencodeSessionId).toBe("ses_test_12345");
    });
  });

  describe("deleteConversation", () => {
    it("removes specified conversation by id and saves updated list", async () => {
      const convos = [
        createMockConversation("c-1"),
        createMockConversation("c-2"),
        createMockConversation("c-3"),
      ];
      mockStorage.set("vicinae_ai_agent_conversations_v1", JSON.stringify(convos));

      await deleteConversation("c-2");

      const stored = JSON.parse(mockStorage.get("vicinae_ai_agent_conversations_v1")!);
      expect(stored).toHaveLength(2);
      expect(stored.map((c: Conversation) => c.id)).toEqual(["c-1", "c-3"]);
    });

    it("does nothing to list if id not found", async () => {
      const convos = [createMockConversation("c-1")];
      mockStorage.set("vicinae_ai_agent_conversations_v1", JSON.stringify(convos));

      await deleteConversation("non-existent");

      const stored = JSON.parse(mockStorage.get("vicinae_ai_agent_conversations_v1")!);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe("c-1");
    });
  });

  describe("clearConversations", () => {
    it("removes storage key via LocalStorage.removeItem", async () => {
      mockStorage.set("vicinae_ai_agent_conversations_v1", "some-data");

      await clearConversations();

      expect(LocalStorage.removeItem).toHaveBeenCalledWith("vicinae_ai_agent_conversations_v1");
      expect(mockStorage.has("vicinae_ai_agent_conversations_v1")).toBe(false);
    });
  });

  describe("renameConversation", () => {
    it("updates the title of existing conversation and returns updated object", async () => {
      const convo = createMockConversation("c-1", "Old Title");
      mockStorage.set("vicinae_ai_agent_conversations_v1", JSON.stringify([convo]));

      const renamed = await renameConversation("c-1", "New Brand Title");

      expect(renamed).not.toBeNull();
      expect(renamed?.title).toBe("New Brand Title");
      expect(renamed?.id).toBe("c-1");

      const stored = JSON.parse(mockStorage.get("vicinae_ai_agent_conversations_v1")!);
      expect(stored[0].title).toBe("New Brand Title");
    });

    it("trims whitespace from new title", async () => {
      const convo = createMockConversation("c-1", "Old Title");
      mockStorage.set("vicinae_ai_agent_conversations_v1", JSON.stringify([convo]));

      const renamed = await renameConversation("c-1", "   Trimmed Title   ");
      expect(renamed?.title).toBe("Trimmed Title");
    });

    it("returns null and does not update when title is empty", async () => {
      const convo = createMockConversation("c-1", "Old Title");
      mockStorage.set("vicinae_ai_agent_conversations_v1", JSON.stringify([convo]));

      const renamed = await renameConversation("c-1", "    ");
      expect(renamed).toBeNull();

      const stored = JSON.parse(mockStorage.get("vicinae_ai_agent_conversations_v1")!);
      expect(stored[0].title).toBe("Old Title");
    });

    it("returns null if conversation id is not found", async () => {
      const convo = createMockConversation("c-1", "Old Title");
      mockStorage.set("vicinae_ai_agent_conversations_v1", JSON.stringify([convo]));

      const renamed = await renameConversation("c-unknown", "New Title");
      expect(renamed).toBeNull();
    });
  });
});
