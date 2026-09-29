export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<any, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) {
          // SSE comment or keepalive (e.g. : OPENROUTER PROCESSING)
          continue;
        }

        if (trimmed.startsWith("data:")) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            return;
          }
          try {
            const parsed = JSON.parse(dataStr);
            yield parsed;
          } catch {
            // Incomplete or non-JSON frame, skip or let next chunk assemble
          }
        }
      }
    }

    if (buffer.trim().startsWith("data:")) {
      const dataStr = buffer.trim().slice(5).trim();
      if (dataStr !== "[DONE]") {
        try {
          yield JSON.parse(dataStr);
        } catch {
          // Ignored
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
