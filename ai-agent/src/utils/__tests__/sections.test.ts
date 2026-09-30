import { describe, expect, it } from "vitest";
import { Message } from "../../types.js";
import { getQuerySections } from "../sections.js";

describe("getQuerySections", () => {
  it("groups messages into query sections by user role", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello", timestamp: 100 },
      { id: "2", role: "assistant", content: "Hi there!", timestamp: 200 },
      { id: "3", role: "user", content: "How are you?", timestamp: 300 },
      { id: "4", role: "assistant", content: "I'm great!", timestamp: 400 },
    ];

    const sections = getQuerySections(messages);
    expect(sections).toHaveLength(2);
    expect(sections[0].index).toBe(0);
    expect(sections[0].userMessage.content).toBe("Hello");
    expect(sections[0].assistantMessage?.content).toBe("Hi there!");
    expect(sections[1].index).toBe(1);
    expect(sections[1].userMessage.content).toBe("How are you?");
    expect(sections[1].assistantMessage?.content).toBe("I'm great!");
  });

  it("handles trailing user message when assistant hasn't responded yet", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello", timestamp: 100 },
    ];

    const sections = getQuerySections(messages);
    expect(sections).toHaveLength(1);
    expect(sections[0].userMessage.content).toBe("Hello");
    expect(sections[0].assistantMessage).toBeUndefined();
  });

  it("handles empty messages list", () => {
    expect(getQuerySections([])).toHaveLength(0);
  });
});
