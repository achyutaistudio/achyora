import { createFileRoute } from "@tanstack/react-router";

/**
 * Streams a generated video file from the AI provider.
 *
 * Veo returns a file URI that requires the server API key, so the browser
 * cannot fetch it directly. This route proxies it server-side: the key stays
 * on the server and only the provider's own file host is reachable.
 */
const ALLOWED_HOST = "generativelanguage.googleapis.com";

export const Route = createFileRoute("/api/public/video-file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const uri = new URL(request.url).searchParams.get("uri");
        if (!uri) return new Response("Missing uri", { status: 400 });

        let target: URL;
        try {
          target = new URL(uri);
        } catch {
          return new Response("Invalid uri", { status: 400 });
        }
        if (target.protocol !== "https:" || target.hostname !== ALLOWED_HOST) {
          return new Response("Unsupported uri", { status: 400 });
        }

        const { fetchProviderVideo } = await import("@/lib/ai/provider.server");
        try {
          const upstream = await fetchProviderVideo(target.toString());
          return new Response(upstream.body, {
            status: 200,
            headers: {
              "content-type": upstream.headers.get("content-type") ?? "video/mp4",
              "cache-control": "private, max-age=600",
            },
          });
        } catch (err) {
          console.error(
            "[achyora] video file proxy failed",
            err instanceof Error ? err.message : err,
          );
          return new Response("Video is not available", { status: 502 });
        }
      },
    },
  },
});
