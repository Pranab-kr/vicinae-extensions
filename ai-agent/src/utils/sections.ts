import { Message } from "../types.js";

export interface QuerySection {
  index: number;
  userMessage: Message;
  assistantMessage?: Message;
}

/**
 * Groups a conversation's messages into paired query sections (turns)
 * where each turn begins with a user message and ends with its corresponding assistant response.
 */
export function getQuerySections(messages: Message[]): QuerySection[] {
  const sections: QuerySection[] = [];
  let currentSection: QuerySection | null = null;

  for (const msg of messages) {
    if (msg.role === "user") {
      currentSection = {
        index: sections.length,
        userMessage: msg,
      };
      sections.push(currentSection);
    } else if (msg.role === "assistant" && currentSection) {
      currentSection.assistantMessage = msg;
    }
  }

  return sections;
}
