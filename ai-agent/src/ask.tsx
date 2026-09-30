import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  Toast,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
  useNavigation,
} from "@vicinae/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchAgentChat } from "./engine/client.js";
import { QuerySwitcher } from "./query-switcher.js";
import { RenameModal } from "./rename-modal.js";
import {
  generateConversationTitle,
  renameConversation,
  saveConversation,
} from "./storage/history.js";
import { Citation, Conversation, Message, Preferences } from "./types.js";
import { normalizeMarkdownForVicinae } from "./utils/markdown.js";
import { QuerySection, getQuerySections } from "./utils/sections.js";

function ReplyModal(props: {
  conversationTitle: string;
  webSearchEnabled: boolean;
  onSubmit: (prompt: string, webSearch: boolean) => void;
}) {
  const { pop } = useNavigation();
  const [webSearch, setWebSearch] = useState(props.webSearchEnabled);
  const isSubmittingRef = useRef(false);

  return (
    <Form
      navigationTitle={`Reply: ${props.conversationTitle}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send Reply"
            icon={Icon.SpeechBubble}
            onSubmit={(values: Form.Values) => {
              if (isSubmittingRef.current) return;
              const text = String(values.prompt || "").trim();
              if (text) {
                isSubmittingRef.current = true;
                pop();
                setTimeout(() => {
                  props.onSubmit(
                    text,
                    typeof values.webSearch === "boolean" ? values.webSearch : webSearch
                  );
                }, 60);
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="prompt"
        title="Follow-up"
        placeholder="Type follow-up question or instructions..."
        autoFocus
      />
      <Form.Checkbox
        id="webSearch"
        title="Web Search"
        label="Enable real-time web search"
        defaultValue={props.webSearchEnabled}
        onChange={setWebSearch}
      />
    </Form>
  );
}

export function ChatView(props: {
  initialConversation: Conversation;
  initialPrompt?: string;
  initialWebSearch?: boolean;
  isPushedFromForm?: boolean;
}) {
  const prefs = getPreferenceValues<Preferences>();
  const { push, pop } = useNavigation();
  const [isLoading, setIsLoading] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    props.initialConversation.enableWebSearch
  );
  const [conversation, setConversation] = useState<Conversation>(props.initialConversation);

  // activeQueryIndex: "all" displays full conversation, number displays that specific query turn
  const [activeQueryIndex, setActiveQueryIndex] = useState<number | "all">("all");

  const [streamingContent, setStreamingContent] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const bufferRef = useRef({ content: "", reasoning: "" });
  const isNavigatingRef = useRef(false);
  const initialExecutionFiredRef = useRef(false);

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

  const executeChat = async (userPrompt: string, useWebSearch: boolean) => {
    const trimmed = userPrompt.trim();
    if (!trimmed || isLoading) return;

    // Check for API key presence
    if (conversation.provider === "openrouter" && !prefs.openrouterApiKey) {
      showToast({
        style: Toast.Style.Failure,
        title: "OpenRouter API Key Missing",
        message: "Please configure your key in extension preferences.",
      });
      return;
    }

    if (conversation.provider === "gemini" && !prefs.geminiApiKey) {
      showToast({
        style: Toast.Style.Failure,
        title: "Gemini API Key Missing",
        message: "Please configure your key in extension preferences.",
      });
      return;
    }

    if (conversation.provider === "openai" && !prefs.openaiApiKey) {
      showToast({
        style: Toast.Style.Failure,
        title: "OpenAI API Key Missing",
        message: "Please configure your key in extension preferences.",
      });
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setIsLoading(true);
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
      enableWebSearch: useWebSearch,
      messages: newMessages,
      updatedAt: Date.now(),
    };

    // Automatically focus on the newly added query turn during streaming
    // This anchors scroll position to the active stream and prevents jumping to previous turns!
    const querySections = getQuerySections(newMessages);
    setActiveQueryIndex(querySections.length - 1);
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
          enableWebSearch: useWebSearch,
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
            showToast({
              style: Toast.Style.Animated,
              title: ev.message,
            });
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

      // Synchronously commit final conversation and clear streaming state in one batch
      setIsLoading(false);
      setStreamingContent("");
      setStreamingReasoning("");
      setStreamingCitations([]);
      setConversation(finalConvo);

      await saveConversation(finalConvo);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        const errorText = err.message || String(err);
        showToast({
          style: Toast.Style.Failure,
          title: errorText.includes("402") ? "OpenRouter: Insufficient Credits" : "Request Failed",
          message: errorText.length > 80 ? errorText.slice(0, 80) + "..." : errorText,
        });

        const errorMsg: Message = {
          id: String(Date.now() + 1),
          role: "assistant",
          content: `⚠️ **Request Failed**\n\n${errorText}`,
          timestamp: Date.now(),
        };

        const failedConvo: Conversation = {
          ...updatedConvo,
          messages: [...newMessages, errorMsg],
          updatedAt: Date.now(),
        };

        setIsLoading(false);
        setStreamingContent("");
        setStreamingReasoning("");
        setStreamingCitations([]);
        setConversation(failedConvo);

        await saveConversation(failedConvo);
      }
    } finally {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Run initial prompt once when pushed from Form
  useEffect(() => {
    if (!initialExecutionFiredRef.current && props.initialPrompt) {
      initialExecutionFiredRef.current = true;
      executeChat(props.initialPrompt, props.initialWebSearch ?? webSearchEnabled);
    }
  }, []);

  const handleRename = async (newTitle: string) => {
    const updated: Conversation = {
      ...conversation,
      title: newTitle,
      updatedAt: Date.now(),
    };
    setConversation(updated);
    if (conversation.messages.length > 0) {
      await renameConversation(conversation.id, newTitle);
    }
    showToast({
      style: Toast.Style.Success,
      title: "Conversation renamed",
    });
  };

  const handleNewConversation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
      throttleTimeoutRef.current = null;
    }
    if (props.isPushedFromForm) {
      pop();
    } else {
      push(
        <Command
          conversation={{
            id: String(Date.now()),
            title: "New Conversation",
            provider: prefs.provider,
            modelId: prefs.modelId,
            enableWebSearch: prefs.enableWebSearch,
            systemPrompt: prefs.systemPrompt || "",
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }}
        />
      );
    }
  };

  const openReplyModal = () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    push(
      <ReplyModal
        conversationTitle={conversation.title}
        webSearchEnabled={webSearchEnabled}
        onSubmit={(prompt, search) => {
          setWebSearchEnabled(search);
          executeChat(prompt, search);
        }}
      />
    );
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 500);
  };

  const openRenameModal = () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    push(
      <RenameModal
        initialTitle={conversation.title}
        onRename={handleRename}
      />
    );
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 500);
  };

  const sections = getQuerySections(conversation.messages);

  const openQuerySwitcher = () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    push(
      <QuerySwitcher
        sections={sections}
        activeQueryIndex={activeQueryIndex}
        onSelect={(selectedIdx) => {
          setActiveQueryIndex(selectedIdx);
          showToast({
            style: Toast.Style.Success,
            title:
              selectedIdx === "all"
                ? "Viewing all questions"
                : `Viewing Query ${selectedIdx + 1}`,
          });
        }}
      />
    );
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 500);
  };

  const scrollToBottom = () => {
    if (sections.length > 0) {
      setActiveQueryIndex(sections.length - 1);
      showToast({
        style: Toast.Style.Success,
        title: `Viewing latest response (Query ${sections.length})`,
      });
    }
  };

  const toggleAllOrActive = () => {
    if (activeQueryIndex === "all") {
      if (sections.length > 0) {
        setActiveQueryIndex(sections.length - 1);
        showToast({
          style: Toast.Style.Success,
          title: `Focusing latest query (${sections.length})`,
        });
      }
    } else {
      setActiveQueryIndex("all");
      showToast({
        style: Toast.Style.Success,
        title: "Showing full conversation",
      });
    }
  };

  const buildMarkdown = useCallback(() => {
    let md = `# ${conversation.title}\n\n`;

    // Render Navigation Banner at the top for easy multi-turn orientation
    if (sections.length > 1) {
      if (activeQueryIndex === "all") {
        md += `> 📜 **Full Conversation (${sections.length} queries)**\n`;
        md += `> ⌨️ *Press **Ctrl+P** to jump to query | **Ctrl+Down** for latest | **Enter** to reply*\n\n---\n\n`;
      } else {
        const currentSec = sections[activeQueryIndex];
        const snippet = currentSec
          ? currentSec.userMessage.content.slice(0, 70).replace(/\n/g, " ")
          : "";
        md += `> 📌 **Query ${activeQueryIndex + 1} of ${sections.length}:** *"${snippet}"*\n`;
        md += `> ⌨️ *Press **Ctrl+P** to switch query | **Ctrl+Shift+A** for all queries | **Enter** to reply*\n\n---\n\n`;
      }
    }

    // Determine which sections to render
    const sectionsToRender =
      activeQueryIndex === "all"
        ? sections
        : sections.filter((_, idx) => idx === activeQueryIndex);

    for (const sec of sectionsToRender) {
      md += `### 👤 You\n${sec.userMessage.content}\n\n`;

      if (sec.assistantMessage) {
        md += `### 🤖 Assistant\n`;
        if (sec.assistantMessage.reasoning) {
          if (showThinking) {
            md += `> 💭 **Thought Process**\n>\n> ${sec.assistantMessage.reasoning.replace(/\n/g, "\n> ")}\n\n`;
          } else {
            md += `> 💭 *Thought process hidden (press Ctrl+Shift+T to show)*\n\n`;
          }
        }
        md += `${sec.assistantMessage.content}\n\n`;
        if (sec.assistantMessage.citations && sec.assistantMessage.citations.length > 0) {
          md += `**Sources:**\n`;
          sec.assistantMessage.citations.forEach((c, idx) => {
            md += `[${idx + 1}] [${c.title}](${c.url})\n`;
          });
          md += `\n`;
        }
      }
      md += `---\n\n`;
    }

    // If currently streaming, display assistant response under the active turn
    if (isLoading) {
      md += `### 🤖 Assistant\n`;
      if (streamingReasoning) {
        if (showThinking) {
          md += `> 💭 **Thought Process**\n>\n> ${streamingReasoning.replace(/\n/g, "\n> ")}`;
        } else {
          md += `> 💭 *Thought process hidden (press Ctrl+Shift+T to show)*`;
        }
        if (streamingContent) {
          md += `\n\n${streamingContent}`;
        }
      } else if (streamingContent) {
        md += streamingContent;
      }
    }

    // Normalize all code blocks (unindented to column 0) so Vicinae's native renderer parses them cleanly
    return normalizeMarkdownForVicinae(md);
  }, [
    conversation,
    activeQueryIndex,
    sections,
    isLoading,
    showThinking,
    streamingContent,
    streamingReasoning,
  ]);

  const lastAssistantMessage = conversation.messages
    .filter((m) => m.role === "assistant")
    .pop()?.content;

  return (
    <Detail
      navigationTitle={conversation.title}
      markdown={buildMarkdown()}
      actions={
        <ActionPanel>
          <Action
            title="Reply / Ask Follow-up"
            icon={Icon.SpeechBubble}
            autoFocus
            shortcut={{ modifiers: ["cmd"], key: "return" }}
            onAction={openReplyModal}
          />
          {sections.length > 1 && (
            <Action
              title="Scroll to Bottom / Latest Response"
              icon={Icon.ArrowDown}
              shortcut={{ modifiers: ["cmd"], key: "arrowDown" }}
              onAction={scrollToBottom}
            />
          )}
          {sections.length > 1 && (
            <ActionPanel.Submenu
              title="Jump to Query (Ctrl+P)"
              icon={Icon.List}
              shortcut={{ modifiers: ["cmd"], key: "p" }}
            >
              <Action
                title="📜 Show All Queries (Full Chat)"
                icon={Icon.BlankDocument}
                onAction={() => {
                  setActiveQueryIndex("all");
                  showToast({ style: Toast.Style.Success, title: "Showing full conversation" });
                }}
              />
              {sections.map((sec, idx) => {
                const userSnippet =
                  sec.userMessage.content.length > 40
                    ? sec.userMessage.content.slice(0, 40) + "..."
                    : sec.userMessage.content;
                return (
                  <Action
                    key={sec.userMessage.id || String(idx)}
                    title={`[Q${idx + 1}] ${userSnippet}`}
                    icon={activeQueryIndex === idx ? Icon.Checkmark : Icon.SpeechBubble}
                    onAction={() => {
                      setActiveQueryIndex(idx);
                      showToast({
                        style: Toast.Style.Success,
                        title: `Viewing Query ${idx + 1}`,
                      });
                    }}
                  />
                );
              })}
              <Action
                title="🔍 Open Searchable List (Full Page)"
                icon={Icon.MagnifyingGlass}
                onAction={openQuerySwitcher}
              />
            </ActionPanel.Submenu>
          )}
          {sections.length > 1 && (
            <Action
              title={
                activeQueryIndex === "all"
                  ? "Focus Current Query Only"
                  : "Show All Queries (Full Chat)"
              }
              icon={Icon.Eye}
              shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
              onAction={toggleAllOrActive}
            />
          )}
          <Action
            title={showThinking ? "Hide Thought Process" : "Show Thought Process"}
            icon={Icon.LightBulb}
            shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}
            onAction={() => {
              setShowThinking((prev) => {
                const next = !prev;
                showToast({
                  style: Toast.Style.Success,
                  title: next ? "Thought Process Visible" : "Thought Process Hidden",
                });
                return next;
              });
            }}
          />
          <Action
            title="Rename Conversation"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            onAction={openRenameModal}
          />
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
            content={lastAssistantMessage ? normalizeMarkdownForVicinae(lastAssistantMessage) : ""}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Cog}
            onAction={openExtensionPreferences}
          />
        </ActionPanel>
      }
    />
  );
}

export function PromptForm(props: {
  initialWebSearch: boolean;
  onSubmit: (prompt: string, webSearch: boolean) => void;
}) {
  const [webSearchEnabled, setWebSearchEnabled] = useState(props.initialWebSearch);

  return (
    <Form
      navigationTitle="Chat with AI Agent"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send Prompt"
            icon={Icon.SpeechBubble}
            onSubmit={(values: Form.Values) => {
              const text = String(values.prompt || "").trim();
              const search =
                typeof values.webSearch === "boolean" ? values.webSearch : webSearchEnabled;
              if (text) {
                setWebSearchEnabled(search);
                props.onSubmit(text, search);
              }
            }}
          />
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
            title="Open Extension Preferences"
            icon={Icon.Cog}
            onAction={openExtensionPreferences}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="prompt"
        title="Prompt"
        placeholder="Ask AI agent anything (Web search enabled)..."
        autoFocus
      />
      <Form.Checkbox
        id="webSearch"
        title="Web Search"
        label="Enable real-time web search and page reading"
        defaultValue={webSearchEnabled}
        onChange={setWebSearchEnabled}
      />
    </Form>
  );
}

export default function Command(props?: { conversation?: Conversation }) {
  const prefs = getPreferenceValues<Preferences>();
  const { push } = useNavigation();

  // If conversation was provided with messages, go directly to ChatView
  if (props?.conversation && props.conversation.messages.length > 0) {
    return <ChatView initialConversation={props.conversation} />;
  }

  // Otherwise, render initial prompt form. Upon submission, push ChatView onto navigation stack.
  // Using push() ensures Vicinae creates a fresh view with active focus, so Enter works immediately!
  const handleSubmitInitialPrompt = (text: string, search: boolean) => {
    const freshConvo: Conversation = props?.conversation || {
      id: String(Date.now()),
      title: "New Conversation",
      provider: prefs.provider,
      modelId: prefs.modelId,
      enableWebSearch: search,
      systemPrompt: prefs.systemPrompt || "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    push(
      <ChatView
        initialConversation={freshConvo}
        initialPrompt={text}
        initialWebSearch={search}
        isPushedFromForm={true}
      />
    );
  };

  return (
    <PromptForm
      initialWebSearch={props?.conversation ? props.conversation.enableWebSearch : prefs.enableWebSearch}
      onSubmit={handleSubmitInitialPrompt}
    />
  );
}
