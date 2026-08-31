import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ensureAccount } from "@/lib/account.server";

/**
 * Signup/sign-in bootstrap: guarantees the authenticated caller has a profile
 * row and an initial credits row. Authenticated (the middleware validates the
 * bearer token), idempotent, and safe to call on every sign-in.
 */
export const ensureAccountBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const claims = context.claims as Record<string, unknown> | undefined;
    const email =
      typeof claims?.["email"] === "string"
        ? (claims["email"] as string)
        : undefined;
    const metadata =
      claims &&
      typeof claims["user_metadata"] === "object" &&
      claims["user_metadata"] !== null
        ? (claims["user_metadata"] as Record<string, unknown>)
        : undefined;

    return ensureAccount({ userId: context.userId, email, metadata });
  });
