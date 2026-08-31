/**
 * Browser-side reader for the SSE chat endpoints (`/api/public/chat`,
 * `/api/chat-stream`). Uses the standard fetch body reader, so tokens are
 * painted as they arrive; nothing is buffered and nothing is faked.
 */
export type ChatStreamHandlers = {
  onDelta: (text: string) => void;
  onDone?: (meta: Record<string, unknown>) => void;
  onError: (error: { code: string; message: string }) => void;
};

type Event =
  | { type: "delta"; text?: string }
  | ({ type: "done" } & Record<string, unknown>)
  | { type: "error"; code?: string; message?: string };

export async function readChatStream(
  res: Response,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const contentType = res.headers.get("content-type") ?? "";

  // Pre-stream failures (quota, rate limit, configuration) stay plain JSON.
  if (!contentType.includes("text/event-stream")) {
    let payload: { ok?: boolean; code?: string; message?: string } = {};
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      payload = {};
    }
    handlers.onError({
      code: payload.code ?? "UNKNOWN",
      message:
        payload.message ??
        "The request could not be completed. Please try again.",
    });
    return;
  }

  const body = res.body;
  if (!body) {
    handlers.onError({
      code: "UNKNOWN",
      message: "The connection dropped. Please try again.",
    });
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let failed = false;

  const handle = (raw: string) => {
    let event: Event;
    try {
      event = JSON.parse(raw) as Event;
    } catch {
      return;
    }
    if (event.type === "delta") {
      if (event.text) handlers.onDelta(event.text);
    } else if (event.type === "error") {
      failed = true;
      handlers.onError({
        code: event.code ?? "AI_SERVICE_ERROR",
        message:
          event.message ?? "The AI service could not complete this request.",
      });
    } else if (event.type === "done") {
      const { type: _type, ...meta } = event;
      handlers.onDone?.(meta);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) handle(line.slice(5).trim());
      }
      sep = buffer.indexOf("\n\n");
    }
  }

  if (!failed && buffer.trim().startsWith("data:")) {
    handle(buffer.trim().slice(5).trim());
  }
}
