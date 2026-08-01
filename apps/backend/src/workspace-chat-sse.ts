const encoder = new TextEncoder();

export function formatSseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function formatSseComment(comment: string): Uint8Array {
  return encoder.encode(`: ${comment}\n\n`);
}

export function writeSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown
): void {
  controller.enqueue(formatSseEvent(event, data));
}

export function writeSseComment(
  controller: ReadableStreamDefaultController<Uint8Array>,
  comment: string
): void {
  controller.enqueue(formatSseComment(comment));
}

export const WORKSPACE_CHAT_SSE_HEADERS = Object.freeze({
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive"
});

export function createWorkspaceChatSseResponse(
  run: (
    controller: ReadableStreamDefaultController<Uint8Array>,
    signal: AbortSignal
  ) => Promise<void>
): Response {
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const abortController = new AbortController();
      pingTimer = setInterval(() => {
        try {
          writeSseComment(controller, "ping");
        } catch {
          clearInterval(pingTimer);
        }
      }, 15_000);

      try {
        await run(controller, abortController.signal);
      } catch {
        writeSse(controller, "error", {
          error: "The writing agent could not complete this turn.",
          code: "WORKSPACE_CHAT_STREAM_FAILED"
        });
      } finally {
        if (pingTimer !== undefined) {
          clearInterval(pingTimer);
        }
        controller.close();
      }
    },
    cancel() {
      if (pingTimer !== undefined) {
        clearInterval(pingTimer);
      }
    }
  });

  return new Response(stream, { headers: WORKSPACE_CHAT_SSE_HEADERS });
}
