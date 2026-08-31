import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState, LoadingState } from "@/components/States";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { useCreditVisibility } from "@/hooks/useCreditVisibility";
import { supabase } from "@/integrations/supabase/client";
import { getAccount } from "@/lib/achyora.functions";
import { createCheckout, getPaymentsStatus } from "@/lib/payments.functions";
import { PLANS } from "@/lib/pricing";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/workspace/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ACHYORA Workspace" },
      {
        name: "description",
        content: "Manage your ACHYORA plan, credits and account.",
      },
      { property: "og:title", content: "Settings — ACHYORA Workspace" },
      {
        property: "og:description",
        content:
          "Plan, credits, billing and sign-out for your ACHYORA account.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsSurface,
});

function SettingsSurface() {
  const navigate = useNavigate();
  const accountFn = useServerFn(getAccount);
  const checkoutFn = useServerFn(createCheckout);
  const paymentsFn = useServerFn(getPaymentsStatus);
  const queryClient = useQueryClient();

  const account = useQuery({
    queryKey: ["account"],
    queryFn: () => accountFn(),
  });
  const payments = useQuery({
    queryKey: ["payments-status"],
    queryFn: () => paymentsFn(),
  });
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [busy, setBusy] = useState<string | null>(null);
  const { showCredits, setShowCredits } = useCreditVisibility();

  async function loadRazorpay(): Promise<void> {
    if (typeof window === "undefined")
      throw new Error("Payments are only available in the browser.");
    if ((window as Window & { Razorpay?: unknown }).Razorpay) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-razorpay-checkout="true"]',
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Could not load Razorpay checkout.")),
          { once: true },
        );
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.dataset["razorpayCheckout"] = "true";
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Could not load Razorpay checkout."));
      document.head.appendChild(script);
    });
  }

  async function upgrade(planId: string) {
    setBusy(planId);
    track("upgrade_clicked");
    try {
      const result = await checkoutFn({ data: { planId, currency } });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      await loadRazorpay();
      type RazorpayInstance = { open: () => void };
      type RazorpayConstructor = new (
        options: Record<string, unknown>,
      ) => RazorpayInstance;
      const Razorpay = (window as Window & { Razorpay?: RazorpayConstructor })
        .Razorpay;
      if (!Razorpay) throw new Error("Razorpay checkout is unavailable.");

      const plan = PLANS.find((item) => item.id === planId);
      const instance = new Razorpay({
        key: result.keyId,
        amount: result.amount,
        currency: result.currency,
        name: "ACHYORA",
        description: plan?.name ?? "ACHYORA Pro",
        order_id: result.orderId,
        prefill: { name: account.data?.profile?.display_name ?? "" },
        theme: { color: "#111827" },
        handler: () => {
          track("subscription_completed");
          toast.success(
            "Payment received. Your plan will activate after secure verification.",
          );
          void queryClient.invalidateQueries({ queryKey: ["account"] });
          setTimeout(
            () => void queryClient.invalidateQueries({ queryKey: ["account"] }),
            3000,
          );
          setTimeout(
            () => void queryClient.invalidateQueries({ queryKey: ["account"] }),
            8000,
          );
        },
        modal: { ondismiss: () => toast.message("Payment window closed.") },
      });
      instance.open();
      track("checkout_started");
    } catch (err) {
      console.error("checkout UI failure", err);
      toast.error(
        err instanceof Error ? err.message : "Could not open payment checkout.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    await navigate({ to: "/", replace: true });
  }

  return (
    <WorkspacePage
      title="Settings"
      description="Your account, preferences and plan."
    >
      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Account
        </p>
        {account.isPending ? (
          <LoadingState label="Loading…" className="mt-3" />
        ) : (
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            <p className="text-foreground">
              {account.data?.profile?.display_name ?? "Your account"}
            </p>
            <p>
              Plan: {account.data?.subscription?.plan ?? "free"} (
              {account.data?.subscription?.status ?? "inactive"})
            </p>
            {showCredits ? (
              <p>Credits: {account.data?.credits?.balance ?? 0}</p>
            ) : null}
          </div>
        )}
        <button
          onClick={() => void signOut()}
          className="mt-4 rounded-xl border border-input bg-secondary px-4 py-2 text-sm text-foreground"
        >
          Sign out
        </button>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Preferences
        </p>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>
              Show credit balance
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Display only. Turning this on or off never changes how credits are
              counted or spent.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showCredits}
            aria-label="Show credit balance"
            onClick={() => setShowCredits(!showCredits)}
            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
              showCredits
                ? "border-ring bg-primary"
                : "border-input bg-secondary"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-background transition-transform ${
                showCredits ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm text-foreground" style={{ fontWeight: 600 }}>
            Plans
          </h2>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "INR" | "USD")}
            className="rounded-xl border border-input bg-secondary px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="INR">₹ INR</option>
            <option value="USD">$ USD</option>
          </select>
        </div>

        {payments.data && !payments.data.razorpay ? (
          <div className="mt-3">
            <ErrorState
              code="PAYMENTS_NOT_CONFIGURED"
              message="Payments are not configured on this deployment yet, so upgrades are unavailable."
            />
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PLANS.filter((p) => p.id !== "free").map((plan) => (
            <div
              key={plan.id}
              className="rounded-2xl border border-border bg-card p-5"
            >
              <p
                className="text-sm text-foreground"
                style={{ fontWeight: 600 }}
              >
                {plan.name}
              </p>
              <p
                className="mt-1 text-2xl text-foreground"
                style={{ fontWeight: 700 }}
              >
                {plan.price[currency]}
              </p>
              <p className="text-xs text-muted-foreground">{plan.cadence}</p>
              <button
                onClick={() => void upgrade(plan.id)}
                disabled={busy !== null || !payments.data?.razorpay}
                className="mt-4 w-full rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ fontWeight: 600 }}
              >
                {busy === plan.id ? "Starting…" : "Upgrade"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </WorkspacePage>
  );
}
