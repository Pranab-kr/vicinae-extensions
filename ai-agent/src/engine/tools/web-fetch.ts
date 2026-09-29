import { isUrlSafe } from "./ssrf.js";

export function extractCleanText(html: string): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "Web Page";

  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ");

  cleaned = cleaned
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  // Cap at ~15,000 characters to prevent context overflow
  const content = cleaned.slice(0, 15000);
  return { title, content };
}

export async function safeFetchWebPage(
  url: string,
  signal?: AbortSignal
): Promise<{ title: string; content: string }> {
  if (!(await isUrlSafe(url))) {
    throw new Error(`Access to target URL blocked by SSRF policy: ${url}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const fetchSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

  try {
    const resp = await fetch(url, {
      signal: fetchSignal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VicinaeAIAgent/1.0)",
        Accept: "text/html,text/plain,application/xhtml+xml",
      },
      redirect: "follow",
    });

    // Re-verify redirected final URL before inspecting HTTP status
    // Ensures unsafe hosts returning 4xx/5xx are blocked immediately by SSRF
    if (resp.url && !(await isUrlSafe(resp.url))) {
      throw new Error(`Redirect to unsafe URL blocked: ${resp.url}`);
    }

    if (!resp.ok) {
      throw new Error(`HTTP Error ${resp.status}: ${resp.statusText}`);
    }

    const contentType = resp.headers.get("content-type") || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/json")
    ) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const text = await resp.text();
    return extractCleanText(text);
  } finally {
    clearTimeout(timeoutId);
  }
}
