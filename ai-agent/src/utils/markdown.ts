/**
 * Utility functions for normalizing markdown for Vicinae's native markdown renderer.
 *
 * Vicinae's native markdown parser (libmd4c / MarkdownModel in C++) requires fenced
 * code blocks to start at column 0 (unindented) and have surrounding blank lines to
 * render properly as MdCodeBlock components. LLMs frequently output code blocks
 * indented within ordered/unordered lists (e.g. `   ```bash ... ````), which otherwise
 * breaks code block rendering.
 */

export function normalizeMarkdownForVicinae(text: string): string {
  if (!text || typeof text !== "string") return "";

  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockIndent = "";
  let codeBlockLang = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inCodeBlock) {
      // Check if line starts an indented or quoted code fence:
      const match = line.match(/^([ \t>]*)```([a-zA-Z0-9_.-]*)/);
      if (match && (match[1] !== "" || match[2] !== undefined)) {
        inCodeBlock = true;
        codeBlockIndent = match[1];
        codeBlockLang = match[2];

        // Ensure a blank line before code block if previous line isn't empty
        if (result.length > 0 && result[result.length - 1].trim() !== "") {
          result.push("");
        }

        result.push("```" + codeBlockLang);
        continue;
      }
      result.push(line);
    } else {
      // We are inside a code block
      // Check for closing fence with optional matching indent, quote, or spaces
      const closeMatch = line.match(/^[ \t>]*```\s*$/);
      if (closeMatch) {
        inCodeBlock = false;
        result.push("```");

        // Peek next line: if next line exists and isn't empty, insert a blank line after
        if (i + 1 < lines.length && lines[i + 1].trim() !== "") {
          result.push("");
        }
        codeBlockIndent = "";
        codeBlockLang = "";
        continue;
      }

      // If code line has the same leading indent/quote as the code fence, strip it
      let processedLine = line;
      if (codeBlockIndent && processedLine.startsWith(codeBlockIndent)) {
        processedLine = processedLine.slice(codeBlockIndent.length);
      } else if (codeBlockIndent && /^[ \t>]+/.test(processedLine)) {
        // Also strip common quote/space prefix if line starts with >
        processedLine = processedLine.replace(/^[ \t>]+/, "");
      }
      result.push(processedLine);
    }
  }

  return result.join("\n");
}
