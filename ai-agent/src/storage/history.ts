import { LocalStorage } from "@vicinae/api";
import { Conversation } from "../types.js";

const STORAGE_KEY = "vicinae_ai_agent_conversations_v1";

export function generateConversationTitle(firstPrompt: string): string {
  const clean = firstPrompt.replace(/\s+/g, " ").trim();
  if (clean.length <= 40) return clean;
  return clean.slice(0, 40) + "...";
}

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveConversation(convo: Conversation): Promise<void> {
  const list = await loadConversations();
  const existingIdx = list.findIndex((c) => c.id === convo.id);
  if (existingIdx >= 0) {
    list[existingIdx] = convo;
  } else {
    list.unshift(convo);
  }

  // Keep top 50 conversations
  const capped = list.slice(0, 50);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
}

export async function deleteConversation(id: string): Promise<void> {
  const list = await loadConversations();
  const filtered = list.filter((c) => c.id !== id);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export async function clearConversations(): Promise<void> {
  await LocalStorage.removeItem(STORAGE_KEY);
}
