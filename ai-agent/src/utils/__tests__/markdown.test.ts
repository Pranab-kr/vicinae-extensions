import { describe, expect, it } from "vitest";
import { formatStreamingTail, normalizeMarkdownForVicinae } from "../markdown.js";

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

describe("formatStreamingTail", () => {
  it("returns content untouched if lines are within threshold", () => {
    const input = "Line 1\nLine 2\nLine 3";
    expect(formatStreamingTail(input, 10)).toBe(input);
  });

  it("preserves code block language and adds comment when slicing inside code block", () => {
    const lines = [
      "Here is the code:",
      "```cpp",
      "#include <iostream>",
      "#include <vector>",
      "int foo() {",
      "    int a = 1;",
      "    int b = 2;",
      "    int c = 3;",
      "    int d = 4;",
      "    int e = 5;",
      "    int f = 6;",
      "    int g = 7;",
      "    int h = 8;",
      "    int i = 9;",
      "    int j = 10;",
      "    return a + j;",
      "}",
      "```",
      "Done!",
    ];
    const input = lines.join("\n");
    const result = formatStreamingTail(input, 5);

    expect(result).toContain("```cpp");
    expect(result).toContain("// ... (earlier code above) ...");
    expect(result).toContain("Done!");
  });

  it("closes unclosed code block if tail ends inside code block", () => {
    const lines = [
      "Intro text",
      "```python",
      "def test():",
      ...Array.from({ length: 25 }, (_, i) => `    var_${i} = ${i};`),
    ];
    const input = lines.join("\n");
    const result = formatStreamingTail(input, 5);

    expect(result).toContain("```python");
    expect(result).toContain("# ... (earlier code above) ...");
    // Must end with closing fence
    expect(result.trim().endsWith("```")).toBe(true);
  });
});
