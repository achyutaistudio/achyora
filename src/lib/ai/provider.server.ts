/**
 * ACHYORA AI provider abstraction.
 *
 * The UI never talks to a provider directly. Every AI capability goes through
 * this router, so the underlying provider can be swapped with environment
 * variables only:
 *
 *   AI_PROVIDER        gemini | openai | anthropic | gateway
 *   AI_CHAT_MODEL      provider-specific model id (optional)
 *   AI_IMAGE_MODEL     provider-specific image model id (optional)
 *   AI_VIDEO_MODEL     provider-specific video model id (optional)
 *   GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
 *   AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY (any OpenAI-compatible host)
 *
 * All calls are direct provider calls over fetch/Web APIs, so the same code
 * runs on Cloudflare Workers and on Vercel. When no provider credential is
 * present, callers receive AI_SERVICE_NOT_CONFIGURED. Output is never faked.
 */
import { serverEnv } from "@/lib/env.server";

export type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

export type ProviderId = "gemini" | "openai" | "anthropic" | "gateway";

export class AiConfigurationError extends Error {
  code = "AI_SERVICE_NOT_CONFIGURED" as const;
}
export class AiServiceError extends Error {
  code = "AI_SERVICE_ERROR" as const;
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
/**
 * Managed OpenAI-compatible gateway. It is only ever used when a gateway
 * credential is actually present (AI_GATEWAY_API_KEY / LOVABLE_API_KEY), and an
 * explicit AI_GATEWAY_BASE_URL always wins.
 */
const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1";

type ResolvedProvider = {
  id: ProviderId;
  key: string;
  chatModel: string;
  imageModel: string;
  videoModel: string;
  /** OpenAI-compatible base url (openai + gateway providers only). */
  baseUrl: string;
};

/**
 * "gateway" is any OpenAI-compatible aggregator endpoint. It is configured with
 * two plain environment variables (AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY),
 * so it stays portable: point it at any compatible host and the app keeps
 * working with no code change.
 */
const OPENAI_BASE = "https://api.openai.com/v1";
function gatewayBase(): string | undefined {
  const base = env("AI_GATEWAY_BASE_URL");
  if (base) return base.replace(/\/+$/, "");
  // A managed credential implies its own host, so hosting that only provides
  // LOVABLE_API_KEY still gets a working gateway with no extra configuration.
  return env("AI_GATEWAY_API_KEY") ? LOVABLE_GATEWAY : undefined;
}

/**
 * The gateway provider is only usable when BOTH variables are present. There is
 * no built-in fallback host: a misconfigured deployment gets a clear error
 * instead of being silently routed through somebody else's service.
 */
function gatewayCredentials(): { baseUrl: string; key: string } | undefined {
  const baseUrl = gatewayBase();
  const key = env("AI_GATEWAY_API_KEY");
  if (!baseUrl || !key) return undefined;
  return { baseUrl, key };
}

export function gatewayConfigurationError(): AiConfigurationError | undefined {
  const baseUrl = gatewayBase();
  const key = env("AI_GATEWAY_API_KEY");
  if (baseUrl && key) return undefined;
  const missing = [
    !baseUrl && "AI_GATEWAY_BASE_URL",
    !key && "AI_GATEWAY_API_KEY",
  ].filter(Boolean) as string[];
  return new AiConfigurationError(
    `AI gateway is not configured. Set ${missing.join(" and ")} to use AI_PROVIDER=gateway.`,
  );
}

function env(name: string): string | undefined {
  return serverEnv(name);
}

type Candidate = {
  id: ProviderId;
  key?: string | undefined;
  chat: string;
  image: string;
  video: string;
  baseUrl: string;
};

function candidates(): Candidate[] {
  return [
    {
      id: "gemini",
      key: env("GEMINI_API_KEY"),
      // Low-latency default. Always overridable with AI_CHAT_MODEL.
      chat: "gemini-flash-latest",
      image: "gemini-2.5-flash-image",
      video: "veo-3.1-fast-generate-preview",
      baseUrl: GEMINI_API,
    },
    {
      id: "openai",
      key: env("OPENAI_API_KEY"),
      chat: "gpt-4.1-mini",
      image: "gpt-image-1",
      video: "",
      baseUrl: env("OPENAI_BASE_URL") ?? OPENAI_BASE,
    },
    {
      id: "anthropic",
      key: env("ANTHROPIC_API_KEY"),
      chat: "claude-sonnet-4-20250514",
      image: "",
      video: "",
      baseUrl: "https://api.anthropic.com/v1",
    },
    {
      id: "gateway",
      key: gatewayCredentials()?.key,
      chat: env("AI_GATEWAY_CHAT_MODEL") ?? "gpt-4o-mini",
      image: env("AI_GATEWAY_IMAGE_MODEL") ?? "google/gemini-2.5-flash-image",
      video: "",
      baseUrl: gatewayCredentials()?.baseUrl ?? "",
    },
  ];
}

/**
 * A configured provider resolved on its own defaults, without the deployment
 * wide AI_*_MODEL overrides (those name a model of the primary provider and
 * would be meaningless on a different vendor). Returns undefined when the
 * provider has no credential here.
 */
function providerOnDefaults(id: ProviderId): ResolvedProvider | undefined {
  const found = candidates().find((c) => c.id === id);
  if (!found?.key) return undefined;
  return {
    id: found.id,
    key: found.key,
    chatModel: found.chat,
    imageModel: found.image,
    videoModel: found.video,
    baseUrl: found.baseUrl,
  };
}

export function resolveProvider(
  preferred?: ProviderId | null,
): ResolvedProvider {
  const requested = (preferred ?? env("AI_PROVIDER") ?? "").toLowerCase() as
    | ProviderId
    | "";
  const candidateList = candidates();

  // AI_PROVIDER is an instruction, not a hint: when it names a provider that is
  // not configured, the deployment gets a configuration error rather than an
  // answer quietly produced by a different vendor.
  if (!preferred && requested) {
    if (requested === "gateway") {
      const gatewayError = gatewayConfigurationError();
      if (gatewayError) throw gatewayError;
    }
    const chosen = candidateList.find((c) => c.id === requested);
    if (!chosen) {
      throw new AiConfigurationError(
        `AI_PROVIDER="${requested}" is not a known provider. Use gemini, openai, anthropic or gateway.`,
      );
    }
    if (!chosen.key) {
      throw new AiConfigurationError(
        `AI_PROVIDER="${requested}" is selected but its API key is not set on this deployment.`,
      );
    }
  }

  const ordered = requested
    ? [
        ...candidateList.filter((c) => c.id === requested),
        ...candidateList.filter((c) => c.id !== requested),
      ]
    : candidateList;

  // An explicitly requested provider is never silently swapped for another one:
  // callers get a configuration error instead of an answer from a different model.
  if (preferred) {
    if (preferred === "gateway") {
      const gatewayError = gatewayConfigurationError();
      if (gatewayError) throw gatewayError;
    }
    const exact = candidateList.find((c) => c.id === preferred);
    if (!exact?.key) {
      throw new AiConfigurationError(
        `The "${preferred}" provider is not configured on this deployment. Add its API key to enable it.`,
      );
    }
  }

  const picked = ordered.find((c) => c.key);
  if (!picked || !picked.key) {
    throw new AiConfigurationError(
      "No AI provider credentials are configured. Set AI_PROVIDER and the matching API key.",
    );
  }

  return {
    id: picked.id,
    key: picked.key,
    chatModel: env("AI_CHAT_MODEL") ?? picked.chat,
    imageModel: env("AI_IMAGE_MODEL") ?? picked.image,
    videoModel: env("AI_VIDEO_MODEL") ?? picked.video,
    baseUrl: picked.baseUrl,
  };
}

export function providerStatus(): {
  configured: boolean;
  provider?: ProviderId;
  model?: string;
} {
  try {
    const p = resolveProvider();
    return { configured: true, provider: p.id, model: p.chatModel };
  } catch {
    return { configured: false };
  }
}

/** Every provider that currently has a usable credential on this deployment. */
export function configuredProviders(): ProviderId[] {
  const all: Array<[ProviderId, string]> = [
    ["gemini", "GEMINI_API_KEY"],
    ["openai", "OPENAI_API_KEY"],
    ["anthropic", "ANTHROPIC_API_KEY"],
  ];
  const ids = all.filter(([, k]) => env(k)).map(([id]) => id);
  if (gatewayCredentials()) ids.push("gateway");
  return ids;
}

export function defaultProvider(): ProviderId | null {
  try {
    return resolveProvider().id;
  } catch {
    return null;
  }
}

/**
 * Turns a provider error body into one readable sentence. Providers answer with
 * deeply nested JSON, and surfacing that raw made every failure look identical
 * in the UI ("The AI service could not complete this request").
 */
async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  let detail = "";
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: string };
      message?: string;
    };
    const e = parsed.error;
    detail = (typeof e === "string" ? e : e?.message) ?? parsed.message ?? "";
  } catch {
    detail = "";
  }
  const text = (detail || body).replace(/\s+/g, " ").trim().slice(0, 300);
  if (res.status === 429) {
    return `The AI provider is out of quota for this key (rate limit or billing). ${text}`.trim();
  }
  if (res.status === 404) {
    return `The AI provider rejected the requested model. ${text}`.trim();
  }
  if (res.status === 401 || res.status === 403) {
    return `The AI provider rejected the API key on this deployment. ${text}`.trim();
  }
  return text || res.statusText;
}

/**
 * Failures that say "this vendor cannot serve the request right now" rather than
 * "the request is wrong": quota, outage, missing model, rejected key. Only these
 * are worth re-trying on another configured provider.
 */
function isTransientProviderError(err: unknown): boolean {
  if (!(err instanceof AiServiceError)) return false;
  const s = err.status;
  return (
    s === 429 || s === 404 || s === 401 || s === 403 || s === 402 || s >= 500
  );
}

/**
 * Same-provider model fallbacks, used only when the deployment did not name a
 * model itself. `gemini-flash-latest` is the fastest first token but is an
 * alias that occasionally answers 503 under load; the pinned id then serves the
 * request instead of failing it.
 */
const FALLBACK_CHAT_MODELS: Partial<Record<ProviderId, string[]>> = {
  gemini: ["gemini-3.6-flash"],
};

function chatModelAttempts(
  provider: ResolvedProvider,
  isPrimary: boolean,
  requested: string | undefined,
): string[] {
  const first = isPrimary
    ? (requested ?? provider.chatModel)
    : provider.chatModel;
  // An explicitly chosen model is never silently swapped for another one.
  if (requested || env("AI_CHAT_MODEL")) return [first];
  return [
    first,
    ...(FALLBACK_CHAT_MODELS[provider.id] ?? []).filter((m) => m !== first),
  ];
}

/**
 * The providers a request may be served by, in order. The primary comes first;
 * additional fully configured providers are only appended when the caller did
 * not pin a provider or model, so an explicit choice is never silently swapped.
 */
function attemptChain(
  primary: ResolvedProvider,
  pinned: boolean,
  capability: "chat" | "image",
): ResolvedProvider[] {
  const chain = [primary];
  if (pinned) return chain;
  for (const id of configuredProviders()) {
    if (id === primary.id) continue;
    const alt = providerOnDefaults(id);
    if (!alt) continue;
    if (capability === "image" && !alt.imageModel) continue;
    chain.push(alt);
  }
  return chain;
}

/* ------------------------------------------------------------------ chat */

async function callChat(
  provider: ResolvedProvider,
  model: string,
  options: {
    messages: ChatMessage[];
    system?: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<string> {
  const system = options.system;

  if (provider.id === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": provider.key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 2048,
        ...(system ? { system } : {}),
        messages: options.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new AiServiceError(await readError(res), res.status);
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return (data.content ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
  }

  if (provider.id === "gemini") {
    const url = `${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": provider.key,
      },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: options.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
      }),
    });
    if (!res.ok) throw new AiServiceError(await readError(res), res.status);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
  }

  // OpenAI-compatible (openai + gateway)
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...options.messages,
      ],
    }),
  });
  if (!res.ok) throw new AiServiceError(await readError(res), res.status);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

export async function chatComplete(options: {
  messages: ChatMessage[];
  system?: string;
  model?: string;
  provider?: ProviderId | null;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const primary = resolveProvider(options.provider ?? null);
  const pinned = Boolean(options.provider || options.model);
  const chain = attemptChain(primary, pinned, "chat");

  let lastError: unknown;
  for (const provider of chain) {
    for (const model of chatModelAttempts(
      provider,
      provider.id === primary.id,
      options.model,
    )) {
      try {
        const text = await callChat(provider, model, options);
        if (text) return text;
        lastError = new AiServiceError(
          "The AI service returned an empty response.",
        );
      } catch (err) {
        lastError = err;
        if (!isTransientProviderError(err)) throw err;
        console.error(
          `ai provider "${provider.id}" (${model}) could not serve this chat request`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AiServiceError("The AI service could not complete this request.");
}

/* ------------------------------------------------------- structured JSON */

/* --------------------------------------------------------- chat streaming */

/**
 * Real provider streaming, using only Web APIs (fetch + ReadableStream +
 * TextDecoder) so the exact same code runs on Node dev and Cloudflare Workers.
 * Nothing is buffered: chunks are yielded as the provider emits them.
 */
async function* sseEvents(res: Response): AsyncGenerator<string> {
  const body = res.body;
  if (!body)
    throw new AiServiceError("The AI provider returned an empty stream.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Events are separated by a blank line; tolerate \r\n hosts.
      let sep = buffer.search(/\r?\n\r?\n/);
      while (sep !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + (buffer[sep] === "\r" ? 4 : 2));
        const data = raw
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (data && data !== "[DONE]") yield data;
        sep = buffer.search(/\r?\n\r?\n/);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function textFromGeminiChunk(json: string): string {
  try {
    const parsed = JSON.parse(json) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (parsed.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
  } catch {
    return "";
  }
}

function textFromOpenAiChunk(json: string): string {
  try {
    const parsed = JSON.parse(json) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
    };
    const choice = parsed.choices?.[0];
    return choice?.delta?.content ?? choice?.message?.content ?? "";
  } catch {
    return "";
  }
}

function textFromAnthropicChunk(json: string): string {
  try {
    const parsed = JSON.parse(json) as {
      type?: string;
      delta?: { text?: string };
    };
    if (parsed.type === "content_block_delta") return parsed.delta?.text ?? "";
    return "";
  } catch {
    return "";
  }
}

/** Opens the streaming request. Throws before the first token when it fails. */
async function openChatStream(
  provider: ResolvedProvider,
  model: string,
  options: { messages: ChatMessage[]; system?: string; maxTokens?: number },
): Promise<AsyncGenerator<string>> {
  const system = options.system;
  const turns = options.messages.filter((m) => m.role !== "system");

  if (provider.id === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": provider.key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: options.maxTokens ?? 2048,
        ...(system ? { system } : {}),
        messages: turns.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new AiServiceError(await readError(res), res.status);
    return map(sseEvents(res), textFromAnthropicChunk);
  }

  if (provider.id === "gemini") {
    const url = `${GEMINI_API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": provider.key,
      },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: turns.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      }),
    });
    if (!res.ok) throw new AiServiceError(await readError(res), res.status);
    return map(sseEvents(res), textFromGeminiChunk);
  }

  // OpenAI-compatible (openai + gateway)
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.key}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...turns,
      ],
    }),
  });
  if (!res.ok) throw new AiServiceError(await readError(res), res.status);
  return map(sseEvents(res), textFromOpenAiChunk);
}

async function* map(
  source: AsyncGenerator<string>,
  transform: (chunk: string) => string,
): AsyncGenerator<string> {
  for await (const raw of source) {
    const text = transform(raw);
    if (text) yield text;
  }
}

/**
 * Streamed chat completion. Same provider routing and fallback semantics as
 * `chatComplete`; failures that happen before the first token fall through to
 * the next configured provider, exactly as the non-streaming path does.
 */
export async function chatStream(options: {
  messages: ChatMessage[];
  system?: string;
  model?: string;
  provider?: ProviderId | null;
  maxTokens?: number;
}): Promise<AsyncGenerator<string>> {
  const primary = resolveProvider(options.provider ?? null);
  const pinned = Boolean(options.provider || options.model);
  const chain = attemptChain(primary, pinned, "chat");

  let lastError: unknown;
  for (const provider of chain) {
    for (const model of chatModelAttempts(
      provider,
      provider.id === primary.id,
      options.model,
    )) {
      try {
        return await openChatStream(provider, model, options);
      } catch (err) {
        lastError = err;
        if (!isTransientProviderError(err)) throw err;
        console.error(
          `ai provider "${provider.id}" (${model}) could not open a chat stream`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AiServiceError("The AI service could not complete this request.");
}

export async function chatJson<T>(options: {
  messages: ChatMessage[];
  system?: string;
  model?: string;
  provider?: ProviderId | null;
}): Promise<T> {
  const raw = await chatComplete({
    ...options,
    system:
      `${options.system ?? ""}\n\nRespond with a single valid JSON object and nothing else. No markdown fences.`.trim(),
  });
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new AiServiceError("The AI response was not valid JSON.");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

/* ----------------------------------------------------------------- image */

async function callImage(
  provider: ResolvedProvider,
  prompt: string,
): Promise<{ dataUrl: string; model: string }> {
  if (provider.id === "gateway") {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({
        model: provider.imageModel,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) throw new AiServiceError(await readError(res), res.status);
    const data = (await res.json()) as {
      choices?: Array<{
        message?: { images?: Array<{ image_url?: { url?: string } }> };
      }>;
    };
    const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url)
      throw new AiServiceError("No image was returned by the provider.");
    return { dataUrl: url, model: provider.imageModel };
  }

  if (provider.id === "openai") {
    const res = await fetch(`${provider.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({ model: provider.imageModel, prompt, n: 1 }),
    });
    if (!res.ok) throw new AiServiceError(await readError(res), res.status);
    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const first = data.data?.[0];
    if (first?.b64_json)
      return {
        dataUrl: `data:image/png;base64,${first.b64_json}`,
        model: provider.imageModel,
      };
    if (first?.url) return { dataUrl: first.url, model: provider.imageModel };
    throw new AiServiceError("No image was returned.");
  }

  if (provider.id === "gemini") {
    // Gemini image models return inline base64 image parts from generateContent.
    const res = await fetch(
      `${GEMINI_API}/models/${encodeURIComponent(provider.imageModel)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": provider.key,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      },
    );
    if (!res.ok) throw new AiServiceError(await readError(res), res.status);
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
        };
      }>;
    };
    const part = (data.candidates?.[0]?.content?.parts ?? []).find(
      (p) => p.inlineData?.data,
    );
    const inline = part?.inlineData;
    if (!inline?.data)
      throw new AiServiceError("No image was returned by the provider.");
    return {
      dataUrl: `data:${inline.mimeType ?? "image/png"};base64,${inline.data}`,
      model: provider.imageModel,
    };
  }

  throw new AiConfigurationError(
    `Image generation is not configured: provider "${provider.id}" does not offer an image model here. Configure GEMINI_API_KEY or OPENAI_API_KEY.`,
  );
}

export async function generateImage(options: {
  prompt: string;
  aspectRatio?: string;
}): Promise<{ dataUrl: string; model: string }> {
  const primary = resolveProvider();
  const prompt =
    options.prompt +
    (options.aspectRatio ? `\n\nAspect ratio: ${options.aspectRatio}.` : "");
  const chain = attemptChain(primary, false, "image").filter(
    (p) => p.id === primary.id || Boolean(p.imageModel),
  );

  let lastError: unknown;
  for (const provider of chain) {
    try {
      return await callImage(provider, prompt);
    } catch (err) {
      lastError = err;
      if (
        err instanceof AiConfigurationError &&
        provider.id === primary.id &&
        chain.length > 1
      ) {
        // The primary vendor has no image model here; another configured one may.
        continue;
      }
      if (!isTransientProviderError(err)) throw err;
      console.error(
        `ai provider "${provider.id}" could not generate this image`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AiServiceError("No image was returned by the provider.");
}

/* ----------------------------------------------------------------- audio */

export async function transcribeAudio(options: {
  base64: string;
  mimeType: string;
}): Promise<string> {
  const provider = resolveProvider();

  if (provider.id === "gemini") {
    const res = await fetch(
      `${GEMINI_API}/models/${encodeURIComponent(provider.chatModel)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": provider.key,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: "Transcribe this audio exactly. Return only the transcript.",
                },
                {
                  inline_data: {
                    mime_type: options.mimeType,
                    data: options.base64,
                  },
                },
              ],
            },
          ],
        }),
      },
    );
    if (!res.ok) throw new AiServiceError(await readError(res), res.status);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
  }

  if (provider.id === "openai") {
    // OpenAI transcription takes multipart audio, not JSON base64.
    const bytes = decodeBase64(options.base64);
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: options.mimeType || "audio/webm" }),
      "audio.webm",
    );
    form.append("model", env("AI_TRANSCRIBE_MODEL") ?? "whisper-1");
    const res = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${provider.key}` },
      body: form,
    });
    if (!res.ok) throw new AiServiceError(await readError(res), res.status);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  }

  throw new AiConfigurationError(
    `Speech input is not configured for provider "${provider.id}" on this deployment. Configure GEMINI_API_KEY or OPENAI_API_KEY.`,
  );
}

function decodeBase64(base64: string): ArrayBuffer {
  const clean = base64.includes(",")
    ? base64.slice(base64.indexOf(",") + 1)
    : base64;
  const binary = atob(clean);
  const buffer = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return buffer;
}

/* ----------------------------------------------------------------- video */

/**
 * Real Google Veo flow through the Gemini API:
 *   predictLongRunning -> operation name -> poll operation -> file uri.
 * The returned file uri needs the server API key, so playback goes through
 * /api/public/video-file which streams it without exposing the key.
 */
export async function createVideoJob(options: {
  prompt: string;
  aspectRatio?: string;
  model?: string;
}): Promise<{ id: string }> {
  const provider = resolveProvider();
  if (provider.id !== "gemini" || !provider.videoModel) {
    throw new AiConfigurationError(
      "Video generation is not configured on this deployment. Set GEMINI_API_KEY (and optionally AI_VIDEO_MODEL) to enable it.",
    );
  }

  const model = options.model ?? provider.videoModel;
  const res = await fetch(
    `${GEMINI_API}/models/${encodeURIComponent(model)}:predictLongRunning`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": provider.key,
      },
      body: JSON.stringify({
        instances: [{ prompt: options.prompt }],
        parameters: {
          ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
          sampleCount: 1,
        },
      }),
    },
  );
  if (!res.ok) throw new AiServiceError(await readError(res), res.status);
  const data = (await res.json()) as { name?: string };
  if (!data.name)
    throw new AiServiceError("The video provider did not return a job id.");
  return { id: data.name };
}

export async function getVideoJob(id: string): Promise<{
  status: string;
  url?: string | undefined;
  error?: string | undefined;
}> {
  const provider = resolveProvider();
  if (provider.id !== "gemini" || !provider.videoModel) {
    throw new AiConfigurationError(
      "Video generation is not configured on this deployment.",
    );
  }
  // Operation names look like "models/veo-.../operations/<id>".
  const path = id.startsWith("/") ? id.slice(1) : id;
  const res = await fetch(`${GEMINI_API}/${path}`, {
    headers: { "x-goog-api-key": provider.key },
  });
  if (!res.ok) throw new AiServiceError(await readError(res), res.status);
  const data = (await res.json()) as {
    done?: boolean;
    error?: { message?: string };
    response?: {
      generateVideoResponse?: {
        generatedSamples?: Array<{ video?: { uri?: string } }>;
        raiMediaFilteredReasons?: string[];
      };
    };
  };

  if (data.error?.message)
    return { status: "failed", error: data.error.message };
  if (!data.done) return { status: "processing" };

  const generated = data.response?.generateVideoResponse;
  const uri = generated?.generatedSamples?.[0]?.video?.uri;
  if (!uri) {
    return {
      status: "failed",
      error:
        generated?.raiMediaFilteredReasons?.[0] ??
        "The provider returned no video for this prompt.",
    };
  }
  return {
    status: "completed",
    url: `/api/public/video-file?uri=${encodeURIComponent(uri)}`,
  };
}

/** Server-side download of a provider video file. Used by the streaming route. */
export async function fetchProviderVideo(uri: string): Promise<Response> {
  const provider = resolveProvider();
  if (provider.id !== "gemini")
    throw new AiConfigurationError("Video generation is not configured.");
  const res = await fetch(uri, { headers: { "x-goog-api-key": provider.key } });
  if (!res.ok) throw new AiServiceError(await readError(res), res.status);
  return res;
}
