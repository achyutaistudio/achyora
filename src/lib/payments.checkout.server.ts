/**
 * Checkout orchestration. Kept out of the server-function module so that
 * build-time server-function splitting cannot strip these runtime helpers.
 */
import { findPlan } from "@/lib/pricing";
import {
  createRazorpayOrder,
  razorpayConfigured,
  PaymentsNotConfiguredError,
} from "@/lib/payments.server";

export function paymentsStatus() {
  return { razorpay: razorpayConfigured() };
}

export async function readSubscription(userId: string) {
  const { supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("plan, status, currency, current_period_end, provider")
    .eq("user_id", userId)
    .maybeSingle();
  return (
    data ?? {
      plan: "free",
      status: "inactive",
      currency: "INR",
      current_period_end: null,
      provider: null,
    }
  );
}

export async function startCheckout(input: {
  userId: string;
  planId: string;
  currency: "INR" | "USD";
}) {
  const plan = findPlan(input.planId);
  if (!plan || plan.id === "free") {
    const err = new Error("Choose a paid plan to continue.");
    (err as { code?: string }).code = "INVALID_INPUT";
    throw err;
  }
  if (!razorpayConfigured()) {
    throw new PaymentsNotConfiguredError(
      "Payments are not configured on this deployment yet. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
    );
  }

  const order = await createRazorpayOrder({
    amount: plan.amount[input.currency],
    currency: input.currency,
    receipt: `ach_${input.userId.slice(0, 8)}_${Date.now()}`,
    notes: {
      user_id: input.userId,
      plan_id: plan.id,
      period_days: String(plan.periodDays ?? 0),
    },
  });

  const { supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  const { error: orderError } = await supabaseAdmin
    .from("payment_orders")
    .insert({
      user_id: input.userId,
      provider: "razorpay",
      provider_order_id: order.id,
      plan_id: plan.id,
      currency: order.currency,
      amount: order.amount,
      status: "created",
    });
  if (orderError)
    throw new Error(`Could not save payment order: ${orderError.message}`);

  const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
    user_id: input.userId,
    event: "checkout_started",
    details: { plan: plan.id, currency: input.currency, order_id: order.id },
  });
  if (auditError)
    console.error("[achyora] checkout audit failed", auditError.message);

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: order.keyId,
  };
}
