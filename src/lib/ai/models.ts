/**
 * ACHYORA model catalog (client-safe).
 *
 * The UI renders only what this catalog describes, and the server filters it
 * down to the providers that actually have credentials on the deployment.
 * Adding a model later is a data change here — no UI rewrite.
 */

export type ProviderId = "gemini" | "openai" | "anthropic" | "gateway";

export type ModelOption = {
  /** Stable ACHYORA id used by the UI and server: "<provider>:<model>". */
  id: string;
  provider: ProviderId;
  /** Provider-native model id, or null to use the deployment default. */
  model: string | null;
  label: string;
  note: string;
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gateway: "AI Gateway",
};

export const MODEL_CATALOG: ModelOption[] = [
  {
    id: "gateway:google/gemini-3.5-flash",
    provider: "gateway",
    model: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    note: "Fast default, via gateway",
  },
  {
    id: "gateway:google/gemini-2.5-pro",
    provider: "gateway",
    model: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    note: "Deeper reasoning, via gateway",
  },
  {
    id: "gateway:openai/gpt-5.6-terra",
    provider: "gateway",
    model: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    note: "Balanced OpenAI model, via gateway",
  },
  {
    id: "gateway:openai/gpt-5.6-luna",
    provider: "gateway",
    model: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    note: "Low-cost and quick, via gateway",
  },
  {
    id: "gemini:gemini-flash-latest",
    provider: "gemini",
    model: "gemini-flash-latest",
    label: "Gemini Flash (latest)",
    note: "Fastest first token, direct Gemini key",
  },
  {
    id: "gemini:gemini-3.6-flash",
    provider: "gemini",
    model: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    note: "Fast, long-context",
  },
  {
    id: "gemini:gemini-3.5-flash",
    provider: "gemini",
    model: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    note: "Balanced, direct Gemini key",
  },
  {
    id: "openai:gpt-4.1-mini",
    provider: "openai",
    model: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    note: "Quick and economical",
  },
  {
    id: "openai:gpt-4.1",
    provider: "openai",
    model: "gpt-4.1",
    label: "GPT-4.1",
    note: "Strong general model",
  },
  {
    id: "anthropic:claude-sonnet-4-20250514",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    note: "Careful long-form writing",
  },
];

export function parseModelId(id: string | null | undefined): {
  provider: ProviderId | null;
  model: string | null;
} {
  if (!id) return { provider: null, model: null };
  const entry = MODEL_CATALOG.find((m) => m.id === id);
  if (!entry) return { provider: null, model: null };
  return { provider: entry.provider, model: entry.model };
}
