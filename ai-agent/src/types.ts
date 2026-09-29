export type Role = "user" | "assistant" | "system";

export interface Citation {
  title: string;
  url: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  reasoning?: string;
  citations?: Citation[];
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  provider: "openrouter" | "gemini" | "openai" | "ollama_custom";
  modelId: string;
  enableWebSearch: boolean;
  systemPrompt: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Preferences {
  provider: "openrouter" | "gemini" | "openai" | "ollama_custom";
  modelId: string;
  openrouterApiKey?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  customBaseUrl?: string;
  enableWebSearch: boolean;
  systemPrompt?: string;
}

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "status"; message: string }
  | { type: "citation"; citation: Citation }
  | { type: "error"; error: string }
  | { type: "done" };
