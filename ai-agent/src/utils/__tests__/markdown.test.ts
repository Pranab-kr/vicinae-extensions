import { describe, expect, it } from "vitest";
import { normalizeMarkdownForVicinae } from "../markdown.js";

describe("normalizeMarkdownForVicinae", () => {
  it("normalizes indented code blocks inside numbered lists (hyprctl issue)", () => {
    const input = `## 6. How to Find Your App's Class

To find the correct class for your app:

1. Launch the app and run:
   \`\`\`bash
   hyprctl clients
   \`\`\`

2. Look for your app's class in the output, or check:
   \`\`\`bash
   hyprctl getprop window_class
   \`\`\`

3. You can also use \`initialClass\` which shows the class at window creation time.`;

    const result = normalizeMarkdownForVicinae(input);

    // Code fence must start at column 0 (no leading spaces)
    expect(result).toMatch(/\n```bash\nhyprctl clients\n```/);
    expect(result).toMatch(/\n```bash\nhyprctl getprop window_class\n```/);
    expect(result).not.toContain("   ```bash");
  });

  it("normalizes code blocks indented with 2 spaces or tabs", () => {
    const input = `- Item one
  \`\`\`python
  def hello():
      print("hi")
  \`\`\`
- Item two`;

    const result = normalizeMarkdownForVicinae(input);
    expect(result).toContain("```python\ndef hello():\n    print(\"hi\")\n```");
  });

  it("leaves already un-indented code blocks untouched", () => {
    const input = `\`\`\`lua
hl.window_rule({
    match = { class = "firefox" },
    fullscreen = true
})
\`\`\``;

    const result = normalizeMarkdownForVicinae(input);
    expect(result).toBe(input);
  });

  it("handles streaming open-ended indented code block", () => {
    const streamingInput = `1. Run this command:
   \`\`\`bash
   hyprctl clients`;

    const result = normalizeMarkdownForVicinae(streamingInput);
    expect(result).toContain("```bash\nhyprctl clients");
    expect(result).not.toContain("   ```bash");
  });

  it("ensures code blocks have surrounding newlines for clean parsing", () => {
    const input = `Some text:
\`\`\`bash
echo test
\`\`\`
Follow-up text`;

    const result = normalizeMarkdownForVicinae(input);
    expect(result).toContain("Some text:\n\n```bash\necho test\n```\n\nFollow-up text");
  });

  it("handles code blocks inside blockquotes", () => {
    const input = `> Quote:
> \`\`\`bash
> echo quoted
> \`\`\``;
    const result = normalizeMarkdownForVicinae(input);
    expect(result).toContain("```bash\necho quoted\n```");
  });

  it("handles multiple code blocks throughout the document", () => {
    const input = `1. First:
   \`\`\`bash
   cmd1
   \`\`\`

2. Second:
   \`\`\`python
   cmd2
   \`\`\``;
    const result = normalizeMarkdownForVicinae(input);
    expect(result).toMatch(/```bash\ncmd1\n```/);
    expect(result).toMatch(/```python\ncmd2\n```/);
    expect(result).not.toContain("   ```");
  });

  it("handles empty or null strings gracefully", () => {
    expect(normalizeMarkdownForVicinae("")).toBe("");
    expect(normalizeMarkdownForVicinae(null as any)).toBe("");
  });
});
