/**
 * Razorpay boundary (India) with room for additional providers.
 *
 * Nothing here trusts the browser: orders are created server-side and
 * subscription state only ever changes from a signature-verified webhook.
 *
 *   RAZORPAY_KEY_ID
 *   RAZORPAY_KEY_SECRET
 *   RAZORPAY_WEBHOOK_SECRET
 */
import { serverEnv } from "@/lib/env.server";

export class PaymentsNotConfiguredError extends Error {
  code = "PAYMENTS_NOT_CONFIGURED" as const;
}
export class PaymentFailedError extends Error {
  code = "PAYMENT_FAILED" as const;
}

function env(name: string): string | undefined {
  return serverEnv(name);
}

export function razorpayConfigured(): boolean {
  return Boolean(
    env("RAZORPAY_KEY_ID") && env("RAZORPAY_KEY_SECRET") && env("RAZORPAY_WEBHOOK_SECRET"),
  );
}

function credentials() {
  const keyId = env("RAZORPAY_KEY_ID");
  const keySecret = env("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    throw new PaymentsNotConfiguredError(
      "Payments are not configured on this deployment. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.",
    );
  }
  return { keyId, keySecret };
}

export type RazorpayOrder = { id: string; amount: number; currency: string; keyId: string };

export async function createRazorpayOrder(input: {
  amount: number; // smallest currency unit
  currency: "INR" | "USD";
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  const { keyId, keySecret } = credentials();
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
    },
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PaymentFailedError(`Razorpay rejected the order request. ${body.slice(0, 200)}`);
  }
  const order = (await res.json()) as { id?: string; amount?: number; currency?: string };
  if (!order.id) throw new PaymentFailedError("Razorpay did not return an order id.");
  return {
    id: order.id,
    amount: order.amount ?? input.amount,
    currency: order.currency ?? input.currency,
    keyId,
  };
}

/**
 * Constant-time webhook signature check using Web Crypto only, so the same
 * code runs on Cloudflare Workers and on Vercel. Returns false when
 * unconfigured.
 */
export async function verifyRazorpaySignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const secret = env("RAZORPAY_WEBHOOK_SECRET");
  if (!secret || !signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const provided = signature.trim().toLowerCase();
  if (provided.length !== expected.length) return false;
  // Constant-time comparison over equal-length hex strings.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
