import { Action, ActionPanel, Icon, List, useNavigation } from "@vicinae/api";
import type { QuerySection } from "./utils/sections.js";

export function QuerySwitcher(props: {
  sections: QuerySection[];
  activeQueryIndex: number | "all";
  onSelect: (index: number | "all") => void;
}) {
  const { pop } = useNavigation();

  return (
    <List
      navigationTitle="Jump to Query (Ctrl+P)"
      searchBarPlaceholder="Filter queries by question text (Enter to jump)..."
    >
      <List.Section title="Navigation">
        <List.Item
          key="all"
          title="All Questions & Answers"
          subtitle="View full conversation history"
          icon={props.activeQueryIndex === "all" ? Icon.Checkmark : Icon.BlankDocument}
          accessories={[
            {
              text: `${props.sections.length} ${props.sections.length === 1 ? "query" : "queries"}`,
            },
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Select All Questions"
                icon={Icon.Checkmark}
                onAction={() => {
                  pop();
                  props.onSelect("all");
                }}
              />
            </ActionPanel>
          }
        />
      </List.Section>
      <List.Section title="Query Sections">
        {props.sections.map((sec, idx) => {
          const isSelected = props.activeQueryIndex === idx;
          const userSnippet =
            sec.userMessage.content.length > 70
              ? `${sec.userMessage.content.slice(0, 70)}...`
              : sec.userMessage.content;
          const assistantSnippet = sec.assistantMessage
            ? `${sec.assistantMessage.content.slice(0, 60).replace(/\n/g, " ")}...`
            : "Streaming or awaiting response...";

          return (
            <List.Item
              key={sec.userMessage.id || String(idx)}
              title={`[Q${idx + 1}] ${userSnippet}`}
              subtitle={assistantSnippet}
              icon={isSelected ? Icon.Checkmark : Icon.SpeechBubble}
              accessories={[
                {
                  text: new Date(sec.userMessage.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                },
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title={`Jump to Query ${idx + 1}`}
                    icon={Icon.ArrowRight}
                    onAction={() => {
                      pop();
                      props.onSelect(idx);
                    }}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
