/**
 * Server-Sent Events plumbing shared by the guest and authenticated chat
 * endpoints. Web-standard only (ReadableStream + TextEncoder), so it behaves
 * identically on Node dev and on Cloudflare Workers.
 *
 * Wire format (one JSON object per SSE `data:` line):
 *   {"type":"delta","text":"..."}
 *   {"type":"done", ...meta}
 *   {"type":"error","code":"AI_SERVICE_ERROR","message":"..."}
 */
export type StreamEvent =
  | { type: "delta"; text: string }
  | ({ type: "done" } & Record<string, unknown>)
  | { type: "error"; code: string; message: string };

export type StreamWriter = (event: StreamEvent) => void;

export function sseResponse(
  run: (send: StreamWriter) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send: StreamWriter = (event) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      try {
        await run(send);
      } catch (err) {
        // Never leak internals: the caller maps known failures itself, this is
        // the last-resort guard so the UI can never hang on "thinking".
        console.error(
          "chat stream failed",
          err instanceof Error ? err.message : err,
        );
        send({
          type: "error",
          code: "AI_SERVICE_ERROR",
          message: "The AI service could not complete this request.",
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
