export interface LiveTranslationEvent {
  type: "chunk" | "reset" | "complete" | "batch-complete" | "error";
  provider?: string;
  text?: string;
  translated?: string;
  error?: string;
  elapsedMs?: number;
  attempts?: number;
  translations?: Array<{ index?: number; text?: string }>;
}

function parseEventBlock(block: string): LiveTranslationEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return null;
  try {
    return JSON.parse(data) as LiveTranslationEvent;
  } catch {
    return null;
  }
}

function findEventBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

/** Reads the live translation SSE response and exposes the first text chunk immediately. */
export async function readLiveTranslationStream(
  response: Response,
  onEvent: (event: LiveTranslationEvent) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  const consume = (block: string) => {
    const event = parseEventBlock(block);
    if (!event) return;
    onEvent(event);
    if (event.type === "reset") accumulated = "";
    if (event.type === "chunk" && event.text) accumulated += event.text;
    if (event.type === "complete" && !accumulated && event.translated) accumulated = event.translated;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = findEventBoundary(buffer);
      while (boundary) {
        consume(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary.length);
        boundary = findEventBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation errors after the stream has already closed.
    }
    reader.releaseLock();
  }

  return accumulated;
}
