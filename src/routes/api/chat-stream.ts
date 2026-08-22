/**
 * Streamed chat for signed-in users.
 *
 * Mirrors `sendChatMessage` (rate limit -> credit spend -> provider -> persist
 * -> refund on failure) but streams the reply token by token. It is a server
 * route rather than a server function because server functions cannot return a
 * streaming Response. Auth is a validated Supabase bearer token; all database
 * writes go through the caller's RLS-scoped client.
 */
import { createFileRoute } from "@tanstack/react-router";

import { ACHYORA_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { parseModelId } from "@/lib/ai/models";
import { AiConfigurationError, AiServiceError, chatStream } from "@/lib/ai/provider.server";
import { sseResponse } from "@/lib/ai/stream.server";
import { refund, spend } from "@/lib/achyora.server";
import { AuthConfigurationError, authenticateRequest } from "@/lib/auth.server";
import { fail } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/ratelimit.server";
import { CREDIT_COSTS } from "@/lib/credits";

const MAX_CHARS = 8000;
const MAX_TURNS = 16;

type Body = {
  conversationId?: string;
  content?: string;
  history?: Array<{ role?: string; content?: string }>;
  modelId?: string;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/chat-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let auth;
        try {
          auth = await authenticateRequest(request);
        } catch (err) {
          if (err instanceof AuthConfigurationError) {
            return json(fail("AI_SERVICE_NOT_CONFIGURED", err.message), 503);
          }
          throw err;
        }
        if (!auth) return json(fail("AUTH_REQUIRED"), 401);

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return json(fail("INVALID_INPUT", "The request body could not be read."), 400);
        }

        const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
        const content = (body.content ?? "").trim().slice(0, MAX_CHARS);
        if (!conversationId) return json(fail("INVALID_INPUT", "Missing conversation."), 400);
        if (!content) return json(fail("INVALID_INPUT", "Write a message first."), 400);

        const history = (body.history ?? [])
          .filter(
            (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
          )
          .slice(-MAX_TURNS)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: (m.content ?? "").slice(0, MAX_CHARS),
          }));

        const limit = await consumeRateLimit("chat", auth.userId);
        if (!limit.allowed) {
          return new Response(JSON.stringify(fail("RATE_LIMITED")), {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(limit.retryAfter),
            },
          });
        }

        const spent = await spend(auth.userId, CREDIT_COSTS.chat, "chat_message");
        if (!spent.ok) return json(fail("INSUFFICIENT_CREDITS"), 402);

        const routed = parseModelId(body.modelId);
        let chunks: AsyncGenerator<string>;
        try {
          chunks = await chatStream({
            system: ACHYORA_SYSTEM_PROMPT,
            messages: [...history, { role: "user", content }],
            provider: routed.provider,
            ...(routed.model ? { model: routed.model } : {}),
          });
        } catch (err) {
          await refund(auth.userId, CREDIT_COSTS.chat, "chat_message_refund").catch(
            () => undefined,
          );
          if (err instanceof AiConfigurationError) {
            return json(fail("AI_SERVICE_NOT_CONFIGURED", err.message), 503);
          }
          console.error("chat stream open failed", err instanceof Error ? err.message : err);
          // Every configured provider/model in the chain already failed. A
          // transient upstream failure (quota, overload, outage) is a "try again"
          // for the user, not a defect: surface one calm sentence and never the
          // provider's raw diagnostic text.
          if (err instanceof AiServiceError) {
            const transient = err.status === 429 || err.status >= 500;
            return json(
              fail(
                "AI_SERVICE_ERROR",
                transient
                  ? "AI service is temporarily busy. Please try again shortly."
                  : err.message,
              ),
              transient ? 503 : 502,
            );
          }
          return json(fail("AI_SERVICE_ERROR"), 502);
        }

        const { supabase, userId } = auth;
        return sseResponse(async (send) => {
          let text = "";
          try {
            for await (const delta of chunks) {
              text += delta;
              send({ type: "delta", text: delta });
            }
          } catch (err) {
            console.error("chat stream failed", err instanceof Error ? err.message : err);
            if (!text) {
              await refund(userId, CREDIT_COSTS.chat, "chat_message_refund").catch(() => undefined);
              send({
                type: "error",
                code: "AI_SERVICE_ERROR",
                message: "The reply was interrupted. Please try again.",
              });
              return;
            }
          }

          if (!text.trim()) {
            await refund(userId, CREDIT_COSTS.chat, "chat_message_refund").catch(() => undefined);
            send({
              type: "error",
              code: "AI_SERVICE_ERROR",
              message: "The AI service returned an empty response.",
            });
            return;
          }

          let title: string | undefined;
          try {
            const { error: messageError } = await supabase.from("messages").insert([
              { conversation_id: conversationId, user_id: userId, role: "user", content },
              {
                conversation_id: conversationId,
                user_id: userId,
                role: "assistant",
                content: text,
              },
            ]);
            if (messageError) throw new Error(messageError.message);
            if (history.length === 0) {
              title = content.replace(/\s+/g, " ").slice(0, 60);
              const { error: titleError } = await supabase
                .from("conversations")
                .update({ title })
                .eq("id", conversationId);
              if (titleError) throw new Error(titleError.message);
            } else {
              const { error: conversationError } = await supabase
                .from("conversations")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", conversationId);
              if (conversationError) throw new Error(conversationError.message);
            }
          } catch (err) {
            // The answer was already delivered. Refund the charge if the durable
            // history write failed, so persistence failure never costs a credit.
            console.error("chat persistence failed", err instanceof Error ? err.message : err);
            await refund(userId, CREDIT_COSTS.chat, "chat_message_persistence_refund").catch(
              (refundErr) => {
                console.error("chat persistence refund failed", refundErr);
              },
            );
          }

          send({ type: "done", balance: spent.balance, ...(title ? { title } : {}) });
        });
      },
    },
  },
});
