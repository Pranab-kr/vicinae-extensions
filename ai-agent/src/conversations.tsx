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
import { useEffect, useState } from "react";
import AskCommand from "./ask.js";
import { clearConversations, deleteConversation, loadConversations } from "./storage/history.js";
import { Conversation } from "./types.js";

export default function ConversationsCommand() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { push } = useNavigation();

  const loadData = async () => {
    setIsLoading(true);
    const list = await loadConversations();
    setConversations(list);
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDelete = async (convo: Conversation) => {
    await deleteConversation(convo.id);
    setConversations((prev) => prev.filter((c) => c.id !== convo.id));
    showToast({ style: Toast.Style.Success, title: "Conversation deleted" });
  };

  const handleClearAll = async () => {
    if (
      await confirmAlert({
        title: "Clear all conversations?",
        message: "This cannot be undone.",
        primaryAction: { title: "Delete All", style: Alert.ActionStyle.Destructive },
      })
    ) {
      await clearConversations();
      setConversations([]);
      showToast({ style: Toast.Style.Success, title: "History cleared" });
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
                  onAction={() => push(<AskCommand conversation={c} />)}
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
