import {
  Action,
  ActionPanel,
  Alert,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useNavigation,
} from "@vicinae/api";
import { useEffect, useRef, useState } from "react";
import AskCommand from "./ask.js";
import {
  clearConversations,
  deleteConversation,
  loadConversations,
  renameConversation,
} from "./storage/history.js";
import { RenameModal } from "./rename-modal.js";
import { Conversation } from "./types.js";

export default function ConversationsCommand() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { push } = useNavigation();
  const isNavigatingRef = useRef(false);

  const navigateToResume = (c: Conversation) => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    push(<AskCommand conversation={c} />);
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 600);
  };

  const navigateToRename = (c: Conversation) => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    push(
      <RenameModal
        initialTitle={c.title}
        onRename={(newTitle) => handleRename(c, newTitle)}
      />
    );
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 600);
  };

  const loadData = async () => {
    setIsLoading(true);
    const list = await loadConversations();
    setConversations(list);
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRename = async (convo: Conversation, newTitle: string) => {
    try {
      await renameConversation(convo.id, newTitle);
      setConversations((prev) =>
        prev.map((item) => (item.id === convo.id ? { ...item, title: newTitle } : item))
      );
      showToast({ style: Toast.Style.Success, title: "Conversation renamed" });
    } catch (err: any) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to rename conversation",
        message: err?.message,
      });
    }
  };

  const handleDelete = async (convo: Conversation) => {
    try {
      await deleteConversation(convo.id);
      setConversations((prev) => prev.filter((c) => c.id !== convo.id));
      showToast({ style: Toast.Style.Success, title: "Conversation deleted" });
    } catch (err: any) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to delete conversation",
        message: err?.message,
      });
    }
  };

  const handleClearAll = async () => {
    if (
      await confirmAlert({
        title: "Clear all conversations?",
        message: "This cannot be undone.",
        primaryAction: { title: "Delete All", style: Alert.ActionStyle.Destructive },
      })
    ) {
      try {
        await clearConversations();
        setConversations([]);
        showToast({ style: Toast.Style.Success, title: "History cleared" });
      } catch (err: any) {
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to clear history",
          message: err?.message,
        });
      }
    }
  };

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search conversation history...">
      {conversations.length === 0 ? (
        <List.EmptyView
          icon={Icon.Clock}
          title="No Conversations Yet"
          description="Ask questions in the Chat command to start conversations"
        />
      ) : (
        conversations.map((c) => (
          <List.Item
            key={c.id}
            title={c.title}
            subtitle={`${c.provider} • ${c.modelId}`}
            accessories={[
              {
                text: `${c.messages.length} msgs`,
                icon: Icon.SpeechBubble,
              },
              {
                text: new Date(c.updatedAt).toLocaleDateString(),
                tooltip: new Date(c.updatedAt).toLocaleString(),
              },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Resume Chat"
                  icon={Icon.ArrowRight}
                  onAction={() => navigateToResume(c)}
                />
                <Action
                  title="Rename Conversation"
                  icon={Icon.Pencil}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                  onAction={() => navigateToRename(c)}
                />
                <Action
                  title="Delete Conversation"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
                  onAction={() => handleDelete(c)}
                />
                <Action
                  title="Clear All History"
                  icon={Icon.XMarkCircle}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
                  onAction={handleClearAll}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
