/**
 * Server-only new-user bootstrap.
 *
 * The managed backend does not allow an `auth.users` trigger, so the profile +
 * credits rows are created server-side, on behalf of an already authenticated
 * user, with the service-role client. Every write is `ON CONFLICT DO NOTHING`
 * shaped (`upsert(..., { ignoreDuplicates: true })`), which makes the whole
 * operation idempotent and retry-safe: calling it on every sign-in never
 * duplicates a row and never overwrites data the user has since edited.
 */

export type BootstrapResult = {
  ok: boolean;
  profileCreated: boolean;
  creditsCreated: boolean;
};

type Identity = {
  userId: string;
  email?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

function displayNameFrom(identity: Identity): string | null {
  const meta = identity.metadata ?? {};
  const candidate =
    (typeof meta["display_name"] === "string" && meta["display_name"]) ||
    (typeof meta["full_name"] === "string" && meta["full_name"]) ||
    (typeof meta["name"] === "string" && meta["name"]) ||
    (identity.email ? identity.email.split("@")[0] : null);
  return candidate ? String(candidate).slice(0, 120) : null;
}

function avatarFrom(identity: Identity): string | null {
  const meta = identity.metadata ?? {};
  const url = meta["avatar_url"] ?? meta["picture"];
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

/**
 * Ensures `profiles` and `user_credits` rows exist for an authenticated user.
 * Safe to call repeatedly and concurrently.
 */
export async function ensureAccount(identity: Identity): Promise<BootstrapResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [existingProfile, existingCredits] = await Promise.all([
    supabaseAdmin.from("profiles").select("id").eq("id", identity.userId).maybeSingle(),
    supabaseAdmin
      .from("user_credits")
      .select("user_id")
      .eq("user_id", identity.userId)
      .maybeSingle(),
  ]);

  let profileCreated = false;
  let creditsCreated = false;

  if (!existingProfile.data) {
    const { error } = await supabaseAdmin.from("profiles").upsert(
      {
        id: identity.userId,
        display_name: displayNameFrom(identity),
        avatar_url: avatarFrom(identity),
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    // A concurrent bootstrap winning the race is not an error.
    if (error && error.code !== "23505") throw new Error(error.message);
    profileCreated = !error;
  }

  if (!existingCredits.data) {
    const { error } = await supabaseAdmin
      .from("user_credits")
      .upsert({ user_id: identity.userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error && error.code !== "23505") throw new Error(error.message);
    creditsCreated = !error;
  }

  return { ok: true, profileCreated, creditsCreated };
}
