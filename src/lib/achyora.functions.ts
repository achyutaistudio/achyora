import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ACHYORA_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  SANATAN_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { MODEL_CATALOG, parseModelId } from "@/lib/ai/models";
import {
  chatComplete,
  configuredProviders,
  defaultProvider,
  chatJson,
  createVideoJob,
  generateImage,
  getVideoJob,
  providerStatus,
  transcribeAudio,
} from "@/lib/ai/provider.server";
import { fail, type AchyoraResult } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/ratelimit.server";
import { serverEnv } from "@/lib/env.server";
import { CREDIT_COSTS } from "@/lib/credits";
import {
  RESEARCH_SHAPE,
  SANATAN_SHAPE,
  audit,
  refund,
  spend,
  toFailure,
} from "@/lib/achyora.server";

/* ------------------------------------------------------------------ types */

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ResearchBrief = {
  summary: string;
  key_findings: string[];
  evidence: Array<{
    claim: string;
    basis: string;
    confidence: "high" | "medium" | "low";
  }>;
  open_questions: string[];
  sources: Array<{ title: string; reference: string; note?: string }>;
  confidence: "high" | "medium" | "low";
};

export type SanatanBrief = ResearchBrief & {
  perspectives: Array<{ tradition: string; position: string }>;
};

/* ------------------------------------------------------------------ status */

export const getAiStatus = createServerFn({ method: "GET" }).handler(async () =>
  providerStatus(),
);

/**
 * The models the UI is allowed to offer: the catalog filtered down to the
 * providers that actually have credentials here. Never advertises a model
 * this deployment cannot really call.
 */
export const getAiCatalog = createServerFn({ method: "GET" }).handler(
  async () => {
    const available = configuredProviders();
    const models = MODEL_CATALOG.filter((m) => available.includes(m.provider));
    const fallback = defaultProvider();
    const defaultModel =
      models.find((m) => m.provider === fallback)?.id ?? models[0]?.id ?? null;
    return { providers: available, models, defaultModel };
  },
);

export const getAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [profile, credits, subscription] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("user_credits")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    return {
      profile: profile.data,
      credits: credits.data ?? {
        balance: 0,
        daily_allowance: 10,
        resets_at: null,
      },
      subscription: subscription.data ?? { plan: "free", status: "inactive" },
    };
  });

/* -------------------------------------------------------------- chat flows */

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { title?: string; surface?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("conversations")
      .insert({
        user_id: context.userId,
        title: data.title?.slice(0, 120) || "New conversation",
        surface: data.surface ?? "chat",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select("id, title, surface, updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const [conv, msgs] = await Promise.all([
      context.supabase
        .from("conversations")
        .select("*")
        .eq("id", data.id)
        .maybeSingle(),
      context.supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", data.id)
        .order("created_at", { ascending: true }),
    ]);
    return { conversation: conv.data, messages: msgs.data ?? [] };
  });

export const renameConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; title: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("conversations")
      .update({ title: data.title.slice(0, 120) || "Untitled" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("conversations")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      conversationId: string;
      content: string;
      history?: ChatTurn[];
      modelId?: string;
    }) => input,
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<
      AchyoraResult<{ message: string; balance: number; title?: string }>
    > => {
      const content = (data.content ?? "").trim().slice(0, 8000);
      if (!content) return fail("INVALID_INPUT", "Write a message first.");

      const limit = await consumeRateLimit("chat", context.userId);
      if (!limit.allowed) return fail("RATE_LIMITED");

      const spent = await spend(
        context.userId,
        CREDIT_COSTS.chat,
        "chat_message",
      );
      if (!spent.ok) return fail("INSUFFICIENT_CREDITS");

      try {
        const history = (data.history ?? []).slice(-16);
        const routed = parseModelId(data.modelId);
        const text = await chatComplete({
          system: ACHYORA_SYSTEM_PROMPT,
          messages: [...history, { role: "user", content }],
          provider: routed.provider,
          ...(routed.model ? { model: routed.model } : {}),
        });
        if (!text) throw new Error("empty response");

        const { error: messageError } = await context.supabase
          .from("messages")
          .insert([
            {
              conversation_id: data.conversationId,
              user_id: context.userId,
              role: "user",
              content,
            },
            {
              conversation_id: data.conversationId,
              user_id: context.userId,
              role: "assistant",
              content: text,
            },
          ]);
        if (messageError)
          throw new Error(
            `Could not save the conversation: ${messageError.message}`,
          );

        let title: string | undefined;
        if (history.length === 0) {
          title = content.replace(/\s+/g, " ").slice(0, 60);
          const { error: titleError } = await context.supabase
            .from("conversations")
            .update({ title })
            .eq("id", data.conversationId);
          if (titleError)
            throw new Error(
              `Could not update the conversation title: ${titleError.message}`,
            );
        } else {
          const { error: conversationError } = await context.supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", data.conversationId);
          if (conversationError)
            throw new Error(
              `Could not update the conversation: ${conversationError.message}`,
            );
        }

        return {
          ok: true,
          message: text,
          balance: spent.balance,
          ...(title ? { title } : {}),
        };
      } catch (err) {
        try {
          await refund(
            context.userId,
            CREDIT_COSTS.chat,
            "chat_message_refund",
          );
        } catch (refundErr) {
          console.error("[achyora] chat refund failed", refundErr);
        }
        return toFailure(err);
      }
    },
  );

/**
 * Real side-by-side comparison: each selected model is called for real and
 * failures are reported per model. Nothing is ever synthesised.
 */
export const compareModels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { prompt: string; modelIds: string[] }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<
      AchyoraResult<{
        results: Array<{
          modelId: string;
          ok: boolean;
          message?: string;
          error?: string;
          code?: string;
        }>;
        balance: number;
      }>
    > => {
      const prompt = (data.prompt ?? "").trim().slice(0, 4000);
      const modelIds = (data.modelIds ?? []).slice(0, 3);
      if (!prompt) return fail("INVALID_INPUT", "Write a prompt to compare.");
      if (modelIds.length < 2)
        return fail("INVALID_INPUT", "Pick at least two models to compare.");

      const compareLimit = await consumeRateLimit("compare", context.userId);
      if (!compareLimit.allowed) return fail("RATE_LIMITED");

      const cost = modelIds.length;
      const spent = await spend(
        context.userId,
        cost * CREDIT_COSTS.comparePerModel,
        "model_comparison",
      );
      if (!spent.ok) return fail("INSUFFICIENT_CREDITS");

      const results = await Promise.all(
        modelIds.map(async (modelId) => {
          const routed = parseModelId(modelId);
          try {
            const message = await chatComplete({
              system: ACHYORA_SYSTEM_PROMPT,
              messages: [{ role: "user", content: prompt }],
              provider: routed.provider,
              ...(routed.model ? { model: routed.model } : {}),
            });
            if (!message)
              throw new Error("The model returned an empty response.");
            return { modelId, ok: true as const, message };
          } catch (err) {
            const failure = toFailure(err);
            return {
              modelId,
              ok: false as const,
              error: failure.message,
              code: failure.code,
            };
          }
        }),
      );

      const failed = results.filter((r) => !r.ok).length;
      if (failed) {
        try {
          await refund(
            context.userId,
            failed * CREDIT_COSTS.comparePerModel,
            "model_comparison_refund",
          );
        } catch (refundErr) {
          console.error("[achyora] comparison refund failed", refundErr);
        }
      }

      return {
        ok: true,
        results,
        balance: Math.max(
          spent.balance + failed * CREDIT_COSTS.comparePerModel,
          0,
        ),
      };
    },
  );

/* ---------------------------------------------------------------- research */

export const runResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { query: string }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<AchyoraResult<{ brief: ResearchBrief; balance: number }>> => {
      const query = (data.query ?? "").trim().slice(0, 2000);
      if (!query) return fail("INVALID_INPUT", "Enter a research question.");

      const researchLimit = await consumeRateLimit("research", context.userId);
      if (!researchLimit.allowed) return fail("RATE_LIMITED");

      const spent = await spend(
        context.userId,
        CREDIT_COSTS.research,
        "research",
      );
      if (!spent.ok) return fail("INSUFFICIENT_CREDITS");

      try {
        const brief = await chatJson<ResearchBrief>({
          system: `${RESEARCH_SYSTEM_PROMPT}\n\n${RESEARCH_SHAPE}`,
          messages: [{ role: "user", content: query }],
        });
        const { error: researchError } = await context.supabase
          .from("research_records")
          .insert({
            user_id: context.userId,
            mode: "general",
            query,
            result: brief,
          });
        if (researchError)
          throw new Error(`Could not save research: ${researchError.message}`);
        return { ok: true, brief, balance: spent.balance };
      } catch (err) {
        try {
          await refund(
            context.userId,
            CREDIT_COSTS.research,
            "research_refund",
          );
        } catch (refundErr) {
          console.error("[achyora] research refund failed", refundErr);
        }
        return toFailure(err);
      }
    },
  );

export const runSanatanResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { query: string }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<AchyoraResult<{ brief: SanatanBrief; balance: number }>> => {
      const query = (data.query ?? "").trim().slice(0, 2000);
      if (!query) return fail("INVALID_INPUT", "Enter a question to research.");

      const sanatanLimit = await consumeRateLimit("research", context.userId);
      if (!sanatanLimit.allowed) return fail("RATE_LIMITED");

      const spent = await spend(
        context.userId,
        CREDIT_COSTS.sanatanResearch,
        "sanatan_research",
      );
      if (!spent.ok) return fail("INSUFFICIENT_CREDITS");

      try {
        const brief = await chatJson<SanatanBrief>({
          system: `${SANATAN_SYSTEM_PROMPT}\n\n${SANATAN_SHAPE}`,
          messages: [{ role: "user", content: query }],
        });
        const { error: researchError } = await context.supabase
          .from("research_records")
          .insert({
            user_id: context.userId,
            mode: "sanatan",
            query,
            result: brief,
          });
        if (researchError)
          throw new Error(`Could not save research: ${researchError.message}`);
        return { ok: true, brief, balance: spent.balance };
      } catch (err) {
        try {
          await refund(
            context.userId,
            CREDIT_COSTS.sanatanResearch,
            "sanatan_research_refund",
          );
        } catch (refundErr) {
          console.error("[achyora] sanatan refund failed", refundErr);
        }
        return toFailure(err);
      }
    },
  );

/* ------------------------------------------------------------------ image */

export const generateImageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { prompt: string; aspectRatio?: string; style?: string }) => input,
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<AchyoraResult<{ url: string; balance: number }>> => {
      const prompt = (data.prompt ?? "").trim().slice(0, 2000);
      if (!prompt) return fail("INVALID_INPUT", "Describe the image you want.");

      const imageLimit = await consumeRateLimit("image", context.userId);
      if (!imageLimit.allowed) return fail("RATE_LIMITED");

      const spent = await spend(
        context.userId,
        CREDIT_COSTS.image,
        "image_generation",
      );
      if (!spent.ok) return fail("INSUFFICIENT_CREDITS");

      try {
        const composed =
          data.style && data.style !== "none"
            ? `${prompt}\n\nStyle: ${data.style}.`
            : prompt;
        const image = await generateImage({
          prompt: composed,
          ...(data.aspectRatio ? { aspectRatio: data.aspectRatio } : {}),
        });
        const { error: mediaError } = await context.supabase
          .from("generated_media")
          .insert({
            user_id: context.userId,
            media_type: "image",
            prompt,
            status: "completed",
            settings: {
              aspectRatio: data.aspectRatio ?? "1:1",
              style: data.style ?? "none",
            },
          });
        if (mediaError)
          throw new Error(
            `Could not save generated image: ${mediaError.message}`,
          );
        await audit(context.userId, "image_generated");
        return { ok: true, url: image.dataUrl, balance: spent.balance };
      } catch (err) {
        try {
          await refund(
            context.userId,
            CREDIT_COSTS.image,
            "image_generation_refund",
          );
        } catch (refundErr) {
          console.error("[achyora] image refund failed", refundErr);
        }
        return toFailure(err);
      }
    },
  );

/* ------------------------------------------------------------------ video */

export const startVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { prompt: string; aspectRatio?: string }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<AchyoraResult<{ jobId: string; balance: number }>> => {
      const prompt = (data.prompt ?? "").trim().slice(0, 2000);
      if (!prompt) return fail("INVALID_INPUT", "Describe the video you want.");

      const videoLimit = await consumeRateLimit("video", context.userId);
      if (!videoLimit.allowed) return fail("RATE_LIMITED");

      const spent = await spend(
        context.userId,
        CREDIT_COSTS.video,
        "video_generation",
      );
      if (!spent.ok) return fail("INSUFFICIENT_CREDITS");

      try {
        const job = await createVideoJob({
          prompt,
          ...(data.aspectRatio ? { aspectRatio: data.aspectRatio } : {}),
        });
        const { error: mediaError } = await context.supabase
          .from("generated_media")
          .insert({
            user_id: context.userId,
            media_type: "video",
            prompt,
            status: "processing",
            settings: {
              jobId: job.id,
              aspectRatio: data.aspectRatio ?? "16:9",
            },
          });
        if (mediaError)
          throw new Error(
            `Could not register video job: ${mediaError.message}`,
          );
        return { ok: true, jobId: job.id, balance: spent.balance };
      } catch (err) {
        try {
          await refund(
            context.userId,
            CREDIT_COSTS.video,
            "video_generation_refund",
          );
        } catch (refundErr) {
          console.error("[achyora] video refund failed", refundErr);
        }
        return toFailure(err);
      }
    },
  );

/**
 * Maximum wall-clock time a single video job may be polled for. Configurable
 * per deployment; polling always terminates on success, failure or this cap.
 */
function videoTimeoutSeconds(): number {
  const raw = Number(serverEnv("VIDEO_MAX_POLL_SECONDS"));
  return Number.isFinite(raw) && raw > 0 ? raw : 600;
}

export const pollVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { jobId: string }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<
      AchyoraResult<{ status: string; url?: string; done?: boolean }>
    > => {
      // Ownership: a job may only be polled by the account that created it.
      const { data: record } = await context.supabase
        .from("generated_media")
        .select("id, created_at, status")
        .eq("user_id", context.userId)
        .eq("media_type", "video")
        .eq("settings->>jobId", data.jobId)
        .maybeSingle();
      if (!record)
        return fail(
          "NOT_FOUND",
          "That video job does not belong to this account.",
        );
      if (record.status === "failed")
        return fail("AI_SERVICE_ERROR", "That video job did not complete.");

      const elapsed =
        (Date.now() - new Date(record.created_at).getTime()) / 1000;
      if (elapsed > videoTimeoutSeconds()) {
        const { data: handled, error: failureError } =
          await context.supabase.rpc("fail_video_and_refund", {
            _media_id: record.id,
            _user_id: context.userId,
            _amount: CREDIT_COSTS.video,
            _reason: "video_generation_timeout_refund",
          });
        if (failureError) throw new Error(failureError.message);
        if (Array.isArray(handled) && !handled[0]?.handled) {
          return fail(
            "AI_SERVICE_ERROR",
            "That video job was already completed or cancelled.",
          );
        }
        return fail(
          "AI_SERVICE_ERROR",
          "The video job took too long and was cancelled. Your credits were returned.",
        );
      }

      try {
        const job = await getVideoJob(data.jobId);
        if (job.status === "failed") {
          const { data: handled, error: failureError } =
            await context.supabase.rpc("fail_video_and_refund", {
              _media_id: record.id,
              _user_id: context.userId,
              _amount: CREDIT_COSTS.video,
              _reason: "video_generation_refund",
            });
          if (failureError) throw new Error(failureError.message);
          if (Array.isArray(handled) && !handled[0]?.handled) {
            return { ok: true, status: "failed", done: true };
          }
          return { ok: true, status: "failed", done: true };
        }
        if (job.url) {
          await context.supabase
            .from("generated_media")
            .update({ status: "completed" })
            .eq("id", record.id);
          return { ok: true, status: job.status, url: job.url, done: true };
        }
        return { ok: true, status: job.status, done: false };
      } catch (err) {
        return toFailure(err);
      }
    },
  );

/* ------------------------------------------------------------------ voice */

export const transcribeVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { base64: string; mimeType: string }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<
      AchyoraResult<{ transcript: string; reply: string; balance: number }>
    > => {
      if (!data.base64) return fail("INVALID_INPUT", "No audio was captured.");
      if (data.base64.length > 8_000_000)
        return fail(
          "FILE_TOO_LARGE",
          "Keep recordings under about 60 seconds.",
        );

      const voiceLimit = await consumeRateLimit("voice", context.userId);
      if (!voiceLimit.allowed) return fail("RATE_LIMITED");

      const spent = await spend(context.userId, CREDIT_COSTS.voice, "voice");
      if (!spent.ok) return fail("INSUFFICIENT_CREDITS");

      try {
        const transcript = await transcribeAudio({
          base64: data.base64,
          mimeType: data.mimeType,
        });
        if (!transcript) throw new Error("empty transcript");
        const reply = await chatComplete({
          system: `${ACHYORA_SYSTEM_PROMPT}\n\nThis message was spoken aloud. Reply concisely, as if speaking back.`,
          messages: [{ role: "user", content: transcript }],
        });
        return { ok: true, transcript, reply, balance: spent.balance };
      } catch (err) {
        try {
          await refund(context.userId, CREDIT_COSTS.voice, "voice_refund");
        } catch (refundErr) {
          console.error("[achyora] voice refund failed", refundErr);
        }
        return toFailure(err);
      }
    },
  );
