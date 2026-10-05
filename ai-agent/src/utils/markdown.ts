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

/**
 * Safely extracts the recent tail of a streaming markdown response while preserving
 * code block fences and structural integrity.
 *
 * If a slice cuts through an open code block, it properly re-opens the code block with
 * its language fence and closes any unclosed fence at the end so Vicinae's native
 * renderer does not break or invert code blocks.
 */
export function formatStreamingTail(content: string, maxLines = 20): string {
  if (!content || typeof content !== "string") return "";

  const lines = content.split("\n");
  if (lines.length <= maxLines + 4) {
    return content;
  }

  let startIdx = lines.length - maxLines;
  let inCodeBlock = false;
  let codeLang = "";
  let codeStartIdx = -1;

  for (let i = 0; i < startIdx; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
        codeStartIdx = i;
      } else {
        inCodeBlock = false;
        codeLang = "";
        codeStartIdx = -1;
      }
    }
  }

  // If the code block started close to startIdx (within 8 lines), snap to include its opening
  if (inCodeBlock && codeStartIdx >= 0 && startIdx - codeStartIdx <= 8) {
    startIdx = codeStartIdx;
    inCodeBlock = false;
  }

  const tailLines = lines.slice(startIdx);

  let tailInCode = inCodeBlock;
  for (const line of tailLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      tailInCode = !tailInCode;
    }
  }

  const result: string[] = [
    "*... [auto-scrolling to latest stream — full text shown when done] ...*\n",
  ];

  if (inCodeBlock) {
    result.push(`\`\`\`${codeLang}`);
    const cStyle = ["py", "python", "sh", "bash", "yaml", "yml", "rb", "r"].includes(
      codeLang.toLowerCase()
    )
      ? "#"
      : "//";
    result.push(`${cStyle} ... (earlier code above) ...`);
  }

  result.push(...tailLines);

  if (tailInCode) {
    result.push("```");
  }

  return result.join("\n");
}

export interface CitationLike {
  title: string;
  url: string;
}

/**
 * Formats citations into a stylish, compact single-line or small bullet box
 * to prevent walls of URLs from overwhelming the screen.
 */
export function formatCompactCitations(
  citations: CitationLike[] | undefined,
  maxDisplay = 5
): string {
  if (!citations || !Array.isArray(citations) || citations.length === 0) {
    return "";
  }

  // Filter out non-content URLs (avatars, icons, asset templates) and deduplicate
  const seenUrls = new Set<string>();
  const validCitations: CitationLike[] = [];

  for (const c of citations) {
    if (!c.url || typeof c.url !== "string") continue;
    const url = c.url.trim();

    if (
      url.includes("avatars.githubusercontent.com") ||
      url.includes("{?") ||
      url.includes("?") && url.includes("{") ||
      url.endsWith(".ico") ||
      /\.(png|jpe?g|gif|svg|webp)(\?.*)?$/i.test(url)
    ) {
      continue;
    }

    const normKey = url.replace(/\/+$/, "").toLowerCase();
    if (seenUrls.has(normKey)) continue;
    seenUrls.add(normKey);

    validCitations.push({ title: c.title || "", url });
  }

  if (validCitations.length === 0) return "";

  const displayed = validCitations.slice(0, maxDisplay);
  const remainingCount = validCitations.length - displayed.length;

  const links = displayed.map((c, idx) => {
    let label = (c.title || "").trim();

    // If title is a raw URL or starts with http, extract a clean domain/path
    if (!label || label.startsWith("http://") || label.startsWith("https://")) {
      try {
        const u = new URL(c.url);
        const host = u.hostname.replace(/^(api\.|www\.)/, "");
        const pathSegments = u.pathname.split("/").filter(Boolean);
        if (pathSegments.length > 2) {
          label = `${host}/.../${pathSegments[pathSegments.length - 1]}`;
        } else if (pathSegments.length > 0) {
          label = `${host}/${pathSegments.join("/")}`;
        } else {
          label = host;
        }
      } catch {
        label = c.url;
      }
    }

    // Truncate long titles to max 32 chars
    if (label.length > 32) {
      label = `${label.slice(0, 29)}...`;
    }

    const safeLabel = label.replace(/[\[\]]/g, "");
    return `[${idx + 1}. ${safeLabel}](${c.url})`;
  });

  let text = `> 🌐 **Sources:** ${links.join(" • ")}`;
  if (remainingCount > 0) {
    text += ` *(+${remainingCount} more)*`;
  }

  return text;
}

