import {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
} from "@vicinae/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchAgentChat } from "./engine/client.js";
import { generateConversationTitle, saveConversation } from "./storage/history.js";
import { Citation, Conversation, Message, Preferences } from "./types.js";

export default function Command(props?: { conversation?: Conversation }) {
  const prefs = getPreferenceValues<Preferences>();
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    props?.conversation ? props.conversation.enableWebSearch : prefs.enableWebSearch
  );

  const [conversation, setConversation] = useState<Conversation>(() => {
    if (props?.conversation) return props.conversation;
    return {
      id: String(Date.now()),
      title: "New Conversation",
      provider: prefs.provider,
      modelId: prefs.modelId,
      enableWebSearch: prefs.enableWebSearch,
      systemPrompt: prefs.systemPrompt || "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  });

  const [streamingContent, setStreamingContent] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const bufferRef = useRef({ content: "", reasoning: "" });

  useEffect(() => {
    return () => {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const buildMarkdown = useCallback(() => {
    let md = "";
    if (conversation.messages.length === 0 && !isLoading) {
      md += `# AI Agent Chat\n\n`;
      md += `* **Provider:** \`${conversation.provider}\`\n`;
      md += `* **Model:** \`${conversation.modelId}\`\n`;
      md += `* **Web Search:** ${webSearchEnabled ? "🟢 Enabled" : "⚪ Disabled"}\n\n`;
      md += `Type your prompt into the search bar above and press **Enter** to chat.\n\n`;
      md += `### Keyboard Shortcuts\n`;
      md += `* **Enter:** Send prompt / follow-up\n`;
      md += `* **Ctrl+Shift+W:** Toggle web search on/off\n`;
      md += `* **Ctrl+Shift+N:** New conversation\n`;
      md += `* **Ctrl+Shift+C:** Copy response\n`;
      return md;
    }

    for (const msg of conversation.messages) {
      if (msg.role === "user") {
        md += `### 👤 You\n${msg.content}\n\n`;
      } else {
        md += `### 🤖 Assistant\n`;
        if (msg.reasoning) {
          md += `<details><summary>Thought Process</summary>\n\n${msg.reasoning}\n\n</details>\n\n`;
        }
        md += `${msg.content}\n\n`;
        if (msg.citations && msg.citations.length > 0) {
          md += `**Sources:**\n`;
          msg.citations.forEach((c, idx) => {
            md += `[${idx + 1}] [${c.title}](${c.url})\n`;
          });
          md += `\n`;
        }
      }
      md += `---\n\n`;
    }

    if (isLoading) {
      md += `### 🤖 Assistant *(Generating...)*\n\n`;
      if (statusMessage) {
        md += `> 🌐 *${statusMessage}*\n\n`;
      }
      if (streamingReasoning) {
        md += `<details open><summary>Thinking...</summary>\n\n${streamingReasoning}\n\n</details>\n\n`;
      }
      md += `${streamingContent}\n\n`;
      if (streamingCitations.length > 0) {
        md += `**Sources:**\n`;
        streamingCitations.forEach((c, idx) => {
          md += `[${idx + 1}] [${c.title}](${c.url})\n`;
        });
      }
    }

    return md;
  }, [
    conversation,
    isLoading,
    statusMessage,
    webSearchEnabled,
    streamingContent,
    streamingReasoning,
    streamingCitations,
  ]);

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;

    // Check for API key presence
    if (prefs.provider === "openrouter" && !prefs.openrouterApiKey) {
      showToast({
        style: Toast.Style.Failure,
        title: "OpenRouter API Key Missing",
        message: "Please configure your key in extension preferences.",
      });
      return;
    }

    if (prefs.provider === "gemini" && !prefs.geminiApiKey) {
      showToast({
        style: Toast.Style.Failure,
        title: "Gemini API Key Missing",
        message: "Please configure your key in extension preferences.",
      });
      return;
    }

    if (prefs.provider === "openai" && !prefs.openaiApiKey) {
      showToast({
        style: Toast.Style.Failure,
        title: "OpenAI API Key Missing",
        message: "Please configure your key in extension preferences.",
      });
      return;
    }

    setPrompt("");
    setIsLoading(true);
    setStatusMessage("");
    setStreamingContent("");
    setStreamingReasoning("");
    setStreamingCitations([]);
    bufferRef.current = { content: "", reasoning: "" };

    const userMsg: Message = {
      id: String(Date.now()),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    const newMessages = [...conversation.messages, userMsg];
    const newTitle =
      conversation.messages.length === 0
        ? generateConversationTitle(trimmed)
        : conversation.title;

    const updatedConvo: Conversation = {
      ...conversation,
      title: newTitle,
      enableWebSearch: webSearchEnabled,
      messages: newMessages,
      updatedAt: Date.now(),
    };

    setConversation(updatedConvo);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const citationsCollected: Citation[] = [];

    try {
      await dispatchAgentChat(
        newMessages,
        {
          ...prefs,
          provider: conversation.provider,
          modelId: conversation.modelId,
          enableWebSearch: webSearchEnabled,
        },
        (ev) => {
          if (ev.type === "token") {
            bufferRef.current.content += ev.text;
            if (!throttleTimeoutRef.current) {
              throttleTimeoutRef.current = setTimeout(() => {
                setStreamingContent(bufferRef.current.content);
                throttleTimeoutRef.current = null;
              }, 70);
            }
          } else if (ev.type === "reasoning") {
            bufferRef.current.reasoning += ev.text;
            setStreamingReasoning(bufferRef.current.reasoning);
          } else if (ev.type === "status") {
            setStatusMessage(ev.message);
          } else if (ev.type === "citation") {
            citationsCollected.push(ev.citation);
            setStreamingCitations([...citationsCollected]);
          } else if (ev.type === "error") {
            showToast({
              style: Toast.Style.Failure,
              title: "Stream Error",
              message: ev.error,
            });
          }
        },
        abortController.signal
      );

      // Clear pending throttle timeout
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }

      // Flush remaining buffer
      const finalAssistantText = bufferRef.current.content;
      const finalReasoning = bufferRef.current.reasoning;

      const assistantMsg: Message = {
        id: String(Date.now() + 1),
        role: "assistant",
        content: finalAssistantText,
        reasoning: finalReasoning || undefined,
        citations: citationsCollected.length > 0 ? citationsCollected : undefined,
        timestamp: Date.now(),
      };

      const finalConvo: Conversation = {
        ...updatedConvo,
        messages: [...newMessages, assistantMsg],
        updatedAt: Date.now(),
      };

      setConversation(finalConvo);
      // Persist conversation only after completion
      await saveConversation(finalConvo);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        showToast({
          style: Toast.Style.Failure,
          title: "Request Failed",
          message: err.message,
        });
      }
    } finally {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      setIsLoading(false);
      setStatusMessage("");
      abortControllerRef.current = null;
    }
  };

  const handleNewConversation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
      throttleTimeoutRef.current = null;
    }
    setConversation({
      id: String(Date.now()),
      title: "New Conversation",
      provider: prefs.provider,
      modelId: prefs.modelId,
      enableWebSearch: prefs.enableWebSearch,
      systemPrompt: prefs.systemPrompt || "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setPrompt("");
    setStreamingContent("");
    setStreamingReasoning("");
    setStreamingCitations([]);
    bufferRef.current = { content: "", reasoning: "" };
    setIsLoading(false);
  };

  return (
    <List
      isShowingDetail
      filtering={false}
      searchText={prompt}
      onSearchTextChange={setPrompt}
      isLoading={isLoading}
      searchBarPlaceholder={
        isLoading
          ? "AI is responding..."
          : conversation.messages.length > 0
          ? "Ask follow-up..."
          : "Ask AI agent anything (Web search enabled)..."
      }
      actions={
        <ActionPanel>
          <Action title="Submit Prompt" icon={Icon.SpeechBubble} onAction={handleSubmit} />
          <Action
            title={`Toggle Web Search (${webSearchEnabled ? "Disable" : "Enable"})`}
            icon={Icon.Globe01}
            shortcut={{ modifiers: ["cmd", "shift"], key: "w" }}
            onAction={() => {
              setWebSearchEnabled(!webSearchEnabled);
              showToast({
                style: Toast.Style.Success,
                title: !webSearchEnabled ? "Web Search Enabled" : "Web Search Disabled",
              });
            }}
          />
          <Action
            title="Start New Conversation"
            icon={Icon.PlusCircle}
            shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
            onAction={handleNewConversation}
          />
          <Action.CopyToClipboard
            title="Copy Last Answer"
            content={
              conversation.messages.filter((m) => m.role === "assistant").pop()?.content || ""
            }
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Cog}
            onAction={openExtensionPreferences}
          />
        </ActionPanel>
      }
    >
      <List.Item
        title={conversation.title}
        detail={<List.Item.Detail markdown={buildMarkdown()} />}
      />
    </List>
  );
}
