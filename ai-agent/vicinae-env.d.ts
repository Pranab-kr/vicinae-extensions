/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** AI Provider - Select the AI backend to use */
	"provider"?: "openrouter" | "gemini" | "openai" | "ollama_custom";

	/** Model ID - Enter the exact model identifier to call */
	"modelId"?: string;

	/** OpenRouter API Key - Your OpenRouter API Key (sk-or-v1-...) */
	"openrouterApiKey": string;

	/** Google Gemini API Key - Your Google AI Studio API Key (AIzaSy...) */
	"geminiApiKey": string;

	/** OpenAI API Key - Your OpenAI API Key (sk-proj-...) */
	"openaiApiKey": string;

	/** Custom Base URL - Base URL for Ollama / LocalAI / OpenAI-compatible endpoint */
	"customBaseUrl": string;

	/** Web Search & Fetch - Enables live web browsing for up-to-date information */
	"enableWebSearch"?: boolean;

	/** System Prompt - Instructions defining the agent's behavior and tone */
	"systemPrompt": string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Chat with AI Agent */
	export type Ask = ExtensionPreferences & {
		
	}

	/** Command: AI Agent Conversations */
	export type Conversations = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Chat with AI Agent */
	export type Ask = {
		
	}

	/** Command: AI Agent Conversations */
	export type Conversations = {
		
	}
}