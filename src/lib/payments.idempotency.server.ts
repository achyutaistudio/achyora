/**
 * Webhook idempotency claim.
 *
 * Primary path: a unique insert into public.processed_webhook_events over
 * PostgREST with the service role key (see db/20260813_webhook_idempotency.sql).
 * A duplicate delivery loses the insert (409) and is acknowledged without
 * granting entitlements again.
 *
 * Fallback: if that table has not been applied to the database yet, an
 * audit_logs lookup guard is used so payments keep working.
 *
 * Server-only by filename; the service role key never leaves this boundary.
 */
import { serverEnv } from "@/lib/env.server";

export type ClaimOutcome = "claimed" | "duplicate" | "error";

type AuditFallbackClient = {
  from: (table: "audit_logs") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => {
          contains: (
            column: string,
            value: Record<string, unknown>,
          ) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null }> };
        };
      };
    };
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
};

export async function claimWebhookEvent(options: {
  eventId: string;
  event: string;
  userId: string;
  provider?: string;
  /** Typed supabase admin client, used only for the audit-log fallback. */
  fallbackClient: unknown;
}): Promise<ClaimOutcome> {
  const url = serverEnv("SUPABASE_URL");
  const serviceKey = serverEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return "error";

  const res = await fetch(`${url}/rest/v1/processed_webhook_events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      id: options.eventId,
      provider: options.provider ?? "razorpay",
      event: options.event,
      user_id: options.userId,
    }),
  });

  if (res.ok) return "claimed";
  if (res.status === 409) return "duplicate"; // unique violation

  const body = await res.text().catch(() => "");
  const tableMissing =
    res.status === 404 || body.includes("PGRST205") || body.includes("does not exist");
  if (!tableMissing) {
    console.error("[achyora] webhook idempotency claim failed", res.status, body.slice(0, 200));
    return "error";
  }

  return claimViaAuditLog(
    options.fallbackClient as AuditFallbackClient,
    options.eventId,
    options.event,
    options.userId,
  );
}

async function claimViaAuditLog(
  client: AuditFallbackClient,
  eventId: string,
  event: string,
  userId: string,
): Promise<ClaimOutcome> {
  const { data } = await client
    .from("audit_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("event", "webhook_received")
    .contains("details", { event_id: eventId })
    .limit(1);
  if (data && data.length > 0) return "duplicate";

  await client
    .from("audit_logs")
    .insert({ user_id: userId, event: "webhook_received", details: { event_id: eventId, event } });
  return "claimed";
}
