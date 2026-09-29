import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "node:dns/promises";
import { isUrlSafe, isPrivateIP } from "../ssrf.js";
import { extractCleanText, safeFetchWebPage } from "../web-fetch.js";
import { searchDuckDuckGo } from "../ddg.js";

describe("isPrivateIP", () => {
  it("identifies private IPv4 addresses", () => {
    expect(isPrivateIP("127.0.0.1")).toBe(true);
    expect(isPrivateIP("127.1.2.3")).toBe(true);
    expect(isPrivateIP("10.0.0.1")).toBe(true);
    expect(isPrivateIP("10.254.254.254")).toBe(true);
    expect(isPrivateIP("172.16.0.1")).toBe(true);
    expect(isPrivateIP("172.31.255.255")).toBe(true);
    expect(isPrivateIP("192.168.0.1")).toBe(true);
    expect(isPrivateIP("192.168.1.100")).toBe(true);
    expect(isPrivateIP("169.254.169.254")).toBe(true);
    expect(isPrivateIP("0.0.0.0")).toBe(true);
  });

  it("identifies public IPv4 addresses", () => {
    expect(isPrivateIP("8.8.8.8")).toBe(false);
    expect(isPrivateIP("1.1.1.1")).toBe(false);
    expect(isPrivateIP("93.184.216.34")).toBe(false);
    expect(isPrivateIP("172.15.255.255")).toBe(false);
    expect(isPrivateIP("172.32.0.1")).toBe(false);
  });

  it("identifies private and loopback IPv6 addresses", () => {
    expect(isPrivateIP("::1")).toBe(true);
    expect(isPrivateIP("::")).toBe(true);
    expect(isPrivateIP("fe80::1")).toBe(true);
    expect(isPrivateIP("fc00::1")).toBe(true);
    expect(isPrivateIP("fd12:3456:789a::1")).toBe(true);
  });

  it("identifies IPv4-mapped IPv6 private addresses", () => {
    expect(isPrivateIP("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIP("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateIP("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIP("::ffff:8.8.8.8")).toBe(false);
  });

  it("identifies public IPv6 addresses", () => {
    expect(isPrivateIP("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIP("2001:4860:4860::8888")).toBe(false);
  });
});

describe("isUrlSafe", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default DNS mock resolves public test domains to a public IP without live network calls
    vi.spyOn(dns, "lookup").mockImplementation(async (hostname: string) => {
      if (hostname === "example.com" || hostname === "en.wikipedia.org") {
        return { address: "93.184.216.34", family: 4 };
      }
      throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects non-http/https protocols", async () => {
    expect(await isUrlSafe("file:///etc/passwd")).toBe(false);
    expect(await isUrlSafe("ftp://server")).toBe(false);
    expect(await isUrlSafe("javascript:alert(1)")).toBe(false);
    expect(await isUrlSafe("gopher://evil.com")).toBe(false);
  });

  it("rejects invalid URLs", async () => {
    expect(await isUrlSafe("not-a-valid-url")).toBe(false);
    expect(await isUrlSafe("")).toBe(false);
  });

  it("rejects localhost and local domain names", async () => {
    expect(await isUrlSafe("http://localhost:8080")).toBe(false);
    expect(await isUrlSafe("http://sub.localhost:3000")).toBe(false);
    expect(await isUrlSafe("http://myhost.local")).toBe(false);
    expect(await isUrlSafe("http://internal.service.internal")).toBe(false);
  });

  it("rejects loopback and private IPv4 addresses", async () => {
    expect(await isUrlSafe("http://127.0.0.1:3000")).toBe(false);
    expect(await isUrlSafe("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(await isUrlSafe("http://192.168.1.1")).toBe(false);
    expect(await isUrlSafe("http://10.0.0.5")).toBe(false);
    expect(await isUrlSafe("http://172.16.0.1")).toBe(false);
    expect(await isUrlSafe("http://0.0.0.0")).toBe(false);
  });

  it("rejects IPv6 loopback, link-local, and ULA addresses", async () => {
    expect(await isUrlSafe("http://[::1]:8080")).toBe(false);
    expect(await isUrlSafe("http://[::]:80")).toBe(false);
    expect(await isUrlSafe("http://[fe80::1]/")).toBe(false);
    expect(await isUrlSafe("http://[fc00::1]/")).toBe(false);
    expect(await isUrlSafe("http://[fd12:3456:789a::1]/")).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 private addresses in URLs", async () => {
    expect(await isUrlSafe("http://[::ffff:127.0.0.1]:8080")).toBe(false);
    expect(await isUrlSafe("http://[::ffff:169.254.169.254]/")).toBe(false);
  });

  it("rejects domains that resolve to private IPs via DNS", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValueOnce({
      address: "127.0.0.1",
      family: 4,
    });
    expect(await isUrlSafe("http://evil-rebinding.com")).toBe(false);
  });

  it("rejects domains when DNS lookup fails", async () => {
    vi.spyOn(dns, "lookup").mockRejectedValueOnce(new Error("ENOTFOUND"));
    expect(await isUrlSafe("http://nonexistent-domain-12345.com")).toBe(false);
  });

  it("allows public domain names (mocked DNS, offline-safe)", async () => {
    expect(await isUrlSafe("https://example.com")).toBe(true);
    expect(await isUrlSafe("https://en.wikipedia.org/wiki/Linux")).toBe(true);
  });

  it("allows public IP addresses", async () => {
    expect(await isUrlSafe("http://93.184.216.34")).toBe(true);
    expect(await isUrlSafe("https://8.8.8.8")).toBe(true);
  });
});

describe("extractCleanText", () => {
  it("strips scripts, styles, and extract readable content", () => {
    const html = `
      <html>
        <head><title>Test Page</title><script>alert(1)</script></head>
        <body>
          <style>.hide { display: none; }</style>
          <h1>Heading</h1>
          <p>This is main content.</p>
        </body>
      </html>
    `;
    const { title, content } = extractCleanText(html);
    expect(title).toBe("Test Page");
    expect(content).toContain("Heading");
    expect(content).toContain("This is main content.");
    expect(content).not.toContain("alert(1)");
    expect(content).not.toContain("display: none");
  });

  it("strips nav and footer elements", () => {
    const html = `
      <html>
        <head><title>Page with Nav and Footer</title></head>
        <body>
          <nav>Navigation links here</nav>
          <main>Main article text</main>
          <footer>Footer copyright info</footer>
        </body>
      </html>
    `;
    const { title, content } = extractCleanText(html);
    expect(title).toBe("Page with Nav and Footer");
    expect(content).toContain("Main article text");
    expect(content).not.toContain("Navigation links here");
    expect(content).not.toContain("Footer copyright info");
  });

  it("falls back to default title when <title> tag is missing", () => {
    const html = `<p>Just some plain paragraph</p>`;
    const { title, content } = extractCleanText(html);
    expect(title).toBe("Web Page");
    expect(content).toBe("Just some plain paragraph");
  });

  it("decodes common HTML entities", () => {
    const html = `<p>&quot;Hello&quot; &amp; &lt;World&gt;&nbsp;!</p>`;
    const { content } = extractCleanText(html);
    expect(content).toBe('"Hello" & <World> !');
  });

  it("caps content at 15,000 characters", () => {
    const longText = "a".repeat(20000);
    const html = `<p>${longText}</p>`;
    const { content } = extractCleanText(html);
    expect(content.length).toBe(15000);
  });
});

describe("safeFetchWebPage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dns, "lookup").mockImplementation(async (hostname: string) => {
      if (hostname === "example.com") {
        return { address: "93.184.216.34", family: 4 };
      }
      throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("blocks unsafe target URLs before fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await expect(safeFetchWebPage("http://127.0.0.1:8080")).rejects.toThrow(
      /blocked by SSRF policy/i
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and extracts clean text from a safe URL", async () => {
    const mockHtml = `
      <html>
        <head><title>Safe Example</title></head>
        <body><p>Cleaned safe content</p></body>
      </html>
    `;
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      url: "https://example.com",
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => mockHtml,
    });

    const result = await safeFetchWebPage("https://example.com");
    expect(result.title).toBe("Safe Example");
    expect(result.content).toContain("Cleaned safe content");
  });

  it("throws on HTTP error status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      url: "https://example.com/missing",
      headers: new Headers({ "content-type": "text/html" }),
    });

    await expect(safeFetchWebPage("https://example.com/missing")).rejects.toThrow(
      /HTTP Error 404/i
    );
  });

  it("blocks unsafe redirect URLs even when redirect target returns error status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      url: "http://169.254.169.254/latest/meta-data",
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "Forbidden",
    });

    await expect(safeFetchWebPage("https://example.com/redirect-to-metadata")).rejects.toThrow(
      /Redirect to unsafe URL blocked/i
    );
  });

  it("throws on unsupported content types", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      url: "https://example.com/image.png",
      headers: new Headers({ "content-type": "image/png" }),
      text: async () => "binary data",
    });

    await expect(safeFetchWebPage("https://example.com/image.png")).rejects.toThrow(
      /Unsupported content type/i
    );
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      safeFetchWebPage("https://example.com", controller.signal)
    ).rejects.toThrow();
  });
});

describe("searchDuckDuckGo", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("queries DuckDuckGo, decodes uddg URLs, and decodes HTML entities", async () => {
    const mockHtml = `
      <div class="result results_links">
        <h2 class="result__title">
          <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=1">Example &amp; &#x27;Test&#x27; <b>Documentation</b></a>
        </h2>
        <a class="result__snippet" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">&quot;Official&quot; guide for &lt;developers&gt;.</a>
      </div>
      <div class="result results_links">
        <h2 class="result__title">
          <a class="result__a" href="https://direct-link.org">Direct Link Title</a>
        </h2>
        <a class="result__snippet">Direct link description snippet.</a>
      </div>
    `;

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => mockHtml,
    });

    const results = await searchDuckDuckGo("example search");
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Example & 'Test' Documentation",
      url: "https://example.com/docs",
      snippet: '"Official" guide for <developers>.',
    });
    expect(results[1]).toEqual({
      title: "Direct Link Title",
      url: "https://direct-link.org",
      snippet: "Direct link description snippet.",
    });
  });

  it("throws on DuckDuckGo HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
    });

    await expect(searchDuckDuckGo("test query")).rejects.toThrow(
      /DuckDuckGo search error: 429/i
    );
  });

  it("returns empty array when no results are found", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<div>No results found</div>",
    });

    const results = await searchDuckDuckGo("empty query");
    expect(results).toEqual([]);
  });

  it("passes abort signal to fetch", async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
      });
    });

    await searchDuckDuckGo("test", controller.signal);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
    controller.abort();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("aborts when caller signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => "",
      });
    });

    await expect(searchDuckDuckGo("test", controller.signal)).rejects.toThrow(
      /aborted/i
    );
  });
});
