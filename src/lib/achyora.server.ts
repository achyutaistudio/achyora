/**
 * Server-only helpers for the ACHYORA server functions.
 *
 * These live outside `achyora.functions.ts` on purpose: server-function
 * modules are split at build time, so runtime siblings must be imported.
 */
import { AiConfigurationError, AiServiceError } from "@/lib/ai/provider.server";
import { fail, type AchyoraFailure } from "@/lib/errors";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function toFailure(err: unknown): AchyoraFailure {
  if (err instanceof AiConfigurationError) return fail("AI_SERVICE_NOT_CONFIGURED", err.message);
  console.error("achyora server failure", err instanceof Error ? err.message : err);
  // A provider error already carries a readable reason (quota, rejected model,
  // rejected key). Passing it through beats showing the same generic sentence
  // for every possible failure.
  if (err instanceof AiServiceError && err.message) return fail("AI_SERVICE_ERROR", err.message);
  return fail("AI_SERVICE_ERROR");
}

/** Atomic, server-side credit spend. Never called from the browser. */
export async function spend(userId: string, amount: number, reason: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("spend_credits", {
    _user_id: userId,
    _amount: amount,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: Boolean(row?.ok), balance: Number(row?.balance ?? 0) };
}

export async function refund(userId: string, amount: number, reason: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { data, error } = await supabaseAdmin.rpc("refund_credits", {
      _user_id: userId,
      _amount: amount,
      _reason: reason,
    });
    if (!error && typeof data === "number") return data;
    lastError = new Error(error?.message ?? "Credit refund did not return a balance.");
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
  }
  console.error("[achyora] credit refund failed after retries", {
    userId,
    amount,
    reason,
    error: lastError?.message,
  });
  throw lastError ?? new Error("Credit refund failed");
}

export async function audit(userId: string, event: string, details: Record<string, Json> = {}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_logs").insert({ user_id: userId, event, details });
}

export const RESEARCH_SHAPE = `Return JSON shaped exactly as:
{"summary": string, "key_findings": string[], "evidence": [{"claim": string, "basis": string, "confidence": "high"|"medium"|"low"}], "open_questions": string[], "sources": [{"title": string, "reference": string, "note": string}], "confidence": "high"|"medium"|"low"}
Leave "sources" as an empty array rather than inventing any reference.`;

export const SANATAN_SHAPE = `Return JSON shaped exactly as:
{"summary": string, "key_findings": string[], "perspectives": [{"tradition": string, "position": string}], "evidence": [{"claim": string, "basis": "scriptural"|"traditional"|"historical"|"archaeological"|"scholarly"|"interpretive"|"disputed"|"uncertain", "confidence": "high"|"medium"|"low"}], "open_questions": string[], "sources": [{"title": string, "reference": string, "note": string}], "confidence": "high"|"medium"|"low"}
Only include a source you are confident actually exists. Otherwise return an empty sources array.`;
