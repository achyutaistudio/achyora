/**
 * Analytics boundary. PostHog is optional: without VITE_POSTHOG_KEY the calls
 * are no-ops, so the app never depends on an analytics vendor being present.
 */

type Props = Record<string, string | number | boolean | null>;

export type AchyoraEvent =
  | "landing_page_viewed"
  | "guest_chat_started"
  | "guest_message_sent"
  | "guest_limit_reached"
  | "sign_in_started"
  | "sign_in_completed"
  | "sign_up_started"
  | "sign_up_completed"
  | "google_sign_in"
  | "chat_started"
  | "message_sent"
  | "image_generation_started"
  | "image_generation_completed"
  | "video_generation_started"
  | "video_generation_completed"
  | "voice_started"
  | "research_started"
  | "sanatan_research_started"
  | "pricing_viewed"
  | "upgrade_clicked"
  | "checkout_started"
  | "subscription_completed";

type PostHogLike = {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, props?: Props) => void;
  identify: (id: string, props?: Props) => void;
  reset: () => void;
};

function client(): PostHogLike | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { posthog?: PostHogLike }).posthog ?? null;
}

let ready = false;

export function initAnalytics() {
  if (ready || typeof window === "undefined") return;
  ready = true;
  const key = import.meta.env["VITE_POSTHOG_KEY"];
  const host = import.meta.env["VITE_POSTHOG_HOST"] ?? "https://us.i.posthog.com";
  const ph = client();
  if (!key || !ph) return;
  ph.init(key, { api_host: host, capture_pageview: false, person_profiles: "identified_only" });
}

/** Never pass prompt text, message bodies, emails or file contents here. */
export function track(event: AchyoraEvent, props?: Props) {
  client()?.capture(event, props);
}

export function identify(userId: string) {
  client()?.identify(userId);
}

export function resetAnalytics() {
  client()?.reset();
}
