import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fail, type AchyoraResult } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/ratelimit.server";
import { startCheckout, readSubscription, paymentsStatus } from "@/lib/payments.checkout.server";

export const getPaymentsStatus = createServerFn({ method: "GET" }).handler(async () =>
  paymentsStatus(),
);

export const getSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => readSubscription(context.userId));

/**
 * Creates a real Razorpay order. The browser only receives the order id and
 * the public key id — access is granted later by the verified webhook.
 */
export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { planId: string; currency: "INR" | "USD" }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<
      AchyoraResult<{ orderId: string; amount: number; currency: string; keyId: string }>
    > => {
      const limit = await consumeRateLimit("checkout", context.userId);
      if (!limit.allowed) return fail("RATE_LIMITED");

      try {
        const order = await startCheckout({
          userId: context.userId,
          planId: data.planId,
          currency: data.currency,
        });
        return { ok: true, ...order };
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "PAYMENTS_NOT_CONFIGURED")
          return fail("PAYMENTS_NOT_CONFIGURED", (err as Error).message);
        if (code === "INVALID_INPUT") return fail("INVALID_INPUT", (err as Error).message);
        console.error("checkout failure", err instanceof Error ? err.message : err);
        return fail("PAYMENT_FAILED");
      }
    },
  );
