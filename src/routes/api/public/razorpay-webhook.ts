import { createFileRoute } from "@tanstack/react-router";

import { verifyRazorpaySignature } from "@/lib/payments.server";
import { findPlan } from "@/lib/pricing";

/**
 * The only place a paid plan becomes active. The database RPC claims the
 * webhook event and mutates the entitlement in one transaction, so a failed
 * write rolls back the claim and Razorpay can retry safely.
 */
export const Route = createFileRoute("/api/public/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const signature = request.headers.get("x-razorpay-signature");

        if (!(await verifyRazorpaySignature(raw, signature))) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: {
          event?: string;
          payload?: {
            payment?: {
              entity?: {
                notes?: Record<string, string>;
                currency?: string;
                order_id?: string;
                amount?: number;
              };
            };
            order?: {
              entity?: {
                notes?: Record<string, string>;
                currency?: string;
                id?: string;
                amount?: number;
              };
            };
          };
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        const payment = payload.payload?.payment?.entity;
        const order = payload.payload?.order?.entity;
        const entity = payment ?? order;
        const notes = entity?.notes ?? {};
        const userId = notes["user_id"];
        const planId = notes["plan_id"];
        const plan = planId ? findPlan(planId) : undefined;
        const event = payload.event ?? "";

        // Only payment/order events can change this order-based entitlement model.
        const successEvent =
          event === "payment.captured" || event === "order.paid";
        const failedEvent = event === "payment.failed";
        if (!successEvent && !failedEvent)
          return new Response("ignored", { status: 200 });

        if (!userId || !plan || plan.id === "free") {
          return new Response("Invalid order mapping", { status: 400 });
        }

        const orderId = payment?.order_id ?? order?.id;
        const currency = entity?.currency;
        if (!orderId || !currency)
          return new Response("Invalid order payload", { status: 400 });
        if (currency !== "INR" && currency !== "USD")
          return new Response("Invalid currency", { status: 400 });

        const expectedAmount = plan.amount[currency];
        if (typeof expectedAmount !== "number")
          return new Response("Invalid plan currency", { status: 400 });
        if (
          successEvent &&
          typeof entity?.amount === "number" &&
          entity.amount !== expectedAmount
        ) {
          return new Response("Payment amount mismatch", { status: 400 });
        }

        const eventId =
          request.headers.get("x-razorpay-event-id") ??
          `${event}:${orderId}:${await sha256Hex(raw)}`;

        const { supabaseAdmin } =
          await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc(
          "process_razorpay_webhook",
          {
            _event_id: eventId,
            _event: event,
            _user_id: userId,
            _plan_id: plan.id,
            _currency: currency,
            _provider_order_id: orderId,
            _period_days: plan.periodDays ?? 0,
            _is_success: successEvent,
          },
        );

        if (error) {
          console.error(
            "[achyora] Razorpay webhook transaction failed",
            error.message,
          );
          return new Response("Webhook processing failed", { status: 500 });
        }

        const status = Array.isArray(data) ? data[0]?.status : undefined;
        if (status === "duplicate")
          return new Response("duplicate", { status: 200 });
        if (status !== "processed")
          return new Response("Webhook not processed", { status: 500 });
        return new Response("ok", { status: 200 });
      },
    },
  },
});

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
