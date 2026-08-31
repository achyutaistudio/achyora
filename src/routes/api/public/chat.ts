import { createFileRoute } from "@tanstack/react-router";

import { ACHYORA_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { AiConfigurationError, chatStream } from "@/lib/ai/provider.server";
import { sseResponse } from "@/lib/ai/stream.server";
import { fail } from "@/lib/errors";
import { visitorHash } from "@/lib/guest.server";
import { anonymousSubject, consumeRateLimit } from "@/lib/ratelimit.server";

const GUEST_LIMIT = 3;
const MAX_CHARS = 4000;
const MAX_TURNS = 12;

type Body = { messages?: Array<{ role?: string; content?: string }> };

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return json(
            fail("INVALID_INPUT", "The request body could not be read."),
            400,
          );
        }

        const messages = (body.messages ?? [])
          .filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string",
          )
          .slice(-MAX_TURNS)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: (m.content ?? "").slice(0, MAX_CHARS),
          }));

        if (
          messages.length === 0 ||
          messages[messages.length - 1]?.role !== "user"
        ) {
          return json(fail("INVALID_INPUT", "Send at least one message."), 400);
        }

        // Abuse protection, separate from the 10-message guest entitlement.
        const limit = await consumeRateLimit(
          "guest_chat",
          anonymousSubject(request),
        );
        if (!limit.allowed) {
          return new Response(JSON.stringify(fail("RATE_LIMITED")), {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(limit.retryAfter),
            },
          });
        }

        const { supabaseAdmin } =
          await import("@/integrations/supabase/client.server");
        const hash = visitorHash(request);

        let data: unknown;
        let error: { message: string } | null = null;
        try {
          ({ data, error } = await supabaseAdmin.rpc("consume_guest_message", {
            _hash: hash,
            _limit: GUEST_LIMIT,
          }));
        } catch (err) {
          console.error(
            "guest quota unavailable",
            err instanceof Error ? err.message : err,
          );
          return json(
            fail(
              "AI_SERVICE_NOT_CONFIGURED",
              "Guest chat is unavailable: the server is missing SUPABASE_SERVICE_ROLE_KEY.",
            ),
            503,
          );
        }

        if (error) {
          console.error("guest quota error", error.message);
          return json(
            fail("UNKNOWN", "Could not verify your free message allowance."),
            500,
          );
        }

        const quota = Array.isArray(data) ? data[0] : data;
        if (!quota?.allowed) {
          return json(
            {
              ...fail(
                "GUEST_LIMIT_REACHED",
                "You've used your 3 free messages for today. Create a free account to keep going.",
              ),
              remaining: 0,
            },
            429,
          );
        }

        // Open the provider stream BEFORE responding, so configuration and
        // provider failures are still plain JSON errors with a real status.
        const refundAttempt = async () => {
          const { error: refundError } = await supabaseAdmin.rpc(
            "release_guest_message",
            {
              _hash: hash,
            },
          );
          if (refundError)
            console.error("guest quota refund failed", refundError.message);
        };

        let chunks: AsyncGenerator<string>;
        try {
          chunks = await chatStream({
            messages,
            system: `${ACHYORA_SYSTEM_PROMPT}\n\nThis person is talking to ACHYORA as a guest. Be genuinely useful in a single, well-formed reply.`,
          });
        } catch (err) {
          // The guest spent an attempt on a failure — give it back.
          await refundAttempt();
          if (err instanceof AiConfigurationError) {
            return json(fail("AI_SERVICE_NOT_CONFIGURED", err.message), 503);
          }
          console.error(
            "guest chat failure",
            err instanceof Error ? err.message : err,
          );
          return json(fail("AI_SERVICE_ERROR"), 502);
        }

        return sseResponse(async (send) => {
          let text = "";
          try {
            for await (const delta of chunks) {
              text += delta;
              send({ type: "delta", text: delta });
            }
          } catch (err) {
            console.error(
              "guest chat stream failure",
              err instanceof Error ? err.message : err,
            );
            if (!text) await refundAttempt();
            send({
              type: "error",
              code: "AI_SERVICE_ERROR",
              message: "The reply was interrupted. Please try again.",
            });
            return;
          }
          if (!text.trim()) {
            await refundAttempt();
            send({
              type: "error",
              code: "AI_SERVICE_ERROR",
              message: "The AI service returned an empty response.",
            });
            return;
          }
          send({ type: "done", remaining: quota.remaining ?? 0 });
        });
      },
    },
  },
});
