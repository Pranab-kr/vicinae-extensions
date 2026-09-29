import { Action, ActionPanel, Form, Icon, useNavigation } from "@vicinae/api";
import { useState } from "react";

export function RenameModal(props: {
  initialTitle: string;
  onRename: (newTitle: string) => Promise<void> | void;
}) {
  const { pop } = useNavigation();
  const [title, setTitle] = useState(props.initialTitle);

  const handleSubmit = async (values: Form.Values) => {
    const trimmed = String(values.title ?? title).trim();
    if (!trimmed) return;
    pop();
    await props.onRename(trimmed);
  };

  return (
    <Form
      navigationTitle="Rename Conversation"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Title"
            icon={Icon.Pencil}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        defaultValue={props.initialTitle}
        placeholder="Enter conversation title..."
        onChange={setTitle}
        autoFocus
      />
    </Form>
  );
}
