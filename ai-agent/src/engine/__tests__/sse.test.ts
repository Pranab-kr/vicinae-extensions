import { describe, it, expect } from "vitest";
import { parseSSEStream } from "../sse.js";

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("parseSSEStream", () => {
  it("ignores comment lines starting with colon like OpenRouter processing", async () => {
    const raw = [
      ": OPENROUTER PROCESSING\n\n",
      "data: {\"text\": \"hello\"}\n\n",
      ": another comment\n",
      "data: {\"text\": \" world\"}\n\n",
      "data: [DONE]\n\n",
    ];
    const stream = createMockStream(raw);
    const events: any[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }
    expect(events).toEqual([{ text: "hello" }, { text: " world" }]);
  });

  it("handles multi-line chunks and incomplete frames across chunks", async () => {
    const raw = [
      "data: {\"te",
      "xt\": \"part1\"}\n\ndata: {\"te",
      "xt\": \"part2\"}\n\n",
    ];
    const stream = createMockStream(raw);
    const events: any[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }
    expect(events).toEqual([{ text: "part1" }, { text: "part2" }]);
  });

  it("terminates when data: [DONE] is encountered", async () => {
    const raw = [
      "data: {\"id\": 1}\n\n",
      "data: [DONE]\n\n",
      "data: {\"id\": 2}\n\n",
    ];
    const stream = createMockStream(raw);
    const events: any[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }
    expect(events).toEqual([{ id: 1 }]);
  });

  it("handles abort signal properly", async () => {
    const controller = new AbortController();
    controller.abort();

    const raw = ["data: {\"text\": \"not reached\"}\n\n"];
    const stream = createMockStream(raw);

    await expect(async () => {
      for await (const _event of parseSSEStream(stream, controller.signal)) {
        // should throw
      }
    }).rejects.toThrow();
  });

  it("ignores invalid JSON frames gracefully", async () => {
    const raw = [
      "data: not-json\n\n",
      "data: {\"valid\": true}\n\n",
    ];
    const stream = createMockStream(raw);
    const events: any[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }
    expect(events).toEqual([{ valid: true }]);
  });

  it("handles trailing buffer without newline at end of stream", async () => {
    const raw = [
      "data: {\"final\": true}",
    ];
    const stream = createMockStream(raw);
    const events: any[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }
    expect(events).toEqual([{ final: true }]);
  });
});
