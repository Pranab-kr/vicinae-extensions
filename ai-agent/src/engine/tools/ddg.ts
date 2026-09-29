export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export async function searchDuckDuckGo(
  query: string,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const fetchSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

  try {
    const resp = await fetch(url, {
      signal: fetchSignal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
        Accept: "text/html",
      },
    });

    if (!resp.ok) {
      throw new Error(`DuckDuckGo search error: ${resp.status}`);
    }

    const html = await resp.text();
    const results: SearchResult[] = [];

    // Match result links: class="result__a" href="..." and result__snippet
    const resultRegex =
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      let rawUrl = match[1];
      // DuckDuckGo redirects through /l/?uddg=<encoded_url>
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          rawUrl = decodeURIComponent(uddgMatch[1]);
        } catch {
          // Keep rawUrl
        }
      }

      const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, "").trim());
      const snippet = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, "").trim());

      if (rawUrl.startsWith("http") && title) {
        results.push({ title, url: rawUrl, snippet });
      }
    }

    return results;
  } finally {
    clearTimeout(timeoutId);
  }
}
