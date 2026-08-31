import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Mic, Paperclip, Sparkles } from "lucide-react";

import { toast } from "sonner";

import { Composer } from "@/components/Composer";
import { MessageList, type UiMessage } from "@/components/MessageList";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { supabase } from "@/integrations/supabase/client";
import { readChatStream } from "@/lib/ai/stream-client";
import {
  createConversation,
  getAiCatalog,
  getConversation,
  compareModels,
} from "@/lib/achyora.functions";
import { track } from "@/lib/analytics";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import {
  CHAT_HISTORY_REFRESH_EVENT,
  CHAT_NEW_EVENT,
  CHAT_OPEN_EVENT,
  requestHistoryRefresh,
} from "@/components/workspace/chat-events";

export const Route = createFileRoute("/workspace/chat")({
  // `prompt` lets another surface (e.g. Sanatan) hand a question over to the
  // existing chat experience without any second chat system.
  validateSearch: (search: Record<string, unknown>): { prompt?: string } => {
    const prompt =
      typeof search["prompt"] === "string"
        ? search["prompt"].slice(0, 2000)
        : "";
    return prompt ? { prompt } : {};
  },
  head: () => ({
    meta: [
      { title: "Chat — ACHYORA Workspace" },
      {
        name: "description",
        content:
          "Chat with ACHYORA across every AI model configured on this deployment.",
      },
      { property: "og:title", content: "Chat — ACHYORA Workspace" },
      {
        property: "og:description",
        content:
          "Saved conversations, model choice and real side-by-side comparison.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChatSurface,
});

function ChatSurface() {
  const { prompt } = Route.useSearch();
  const qc = useQueryClient();
  const getFn = useServerFn(getConversation);
  const createFn = useServerFn(createConversation);
  const compareFn = useServerFn(compareModels);
  const catalogFn = useServerFn(getAiCatalog);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(
    null,
  );
  const [modelId, setModelId] = useState<string>("");
  const [compareMode, setCompareMode] = useState(false);
  // Incremented on "stop": any in-flight reply that resolves afterwards is discarded.
  const runRef = useRef(0);
  const [compareWith, setCompareWith] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Array<{
    modelId: string;
    ok: boolean;
    message?: string;
    error?: string;
  }> | null>(null);

  const catalog = useQuery({
    queryKey: ["ai-catalog"],
    queryFn: () => catalogFn(),
  });

  useEffect(() => {
    const onNewChat = () => {
      void startNew();
    };
    const onOpenChat = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id ?? "";
      if (!id) {
        setActiveId(null);
        setMessages([]);
        setError(null);
        setComparison(null);
        return;
      }
      void openConversation(id);
    };
    const onHistoryRefresh = () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    };

    window.addEventListener(CHAT_NEW_EVENT, onNewChat);
    window.addEventListener(CHAT_OPEN_EVENT, onOpenChat);
    window.addEventListener(CHAT_HISTORY_REFRESH_EVENT, onHistoryRefresh);
    return () => {
      window.removeEventListener(CHAT_NEW_EVENT, onNewChat);
      window.removeEventListener(CHAT_OPEN_EVENT, onOpenChat);
      window.removeEventListener(CHAT_HISTORY_REFRESH_EVENT, onHistoryRefresh);
    };
  }, [qc]);

  const models = catalog.data?.models ?? [];
  useEffect(() => {
    if (!modelId && catalog.data?.defaultModel)
      setModelId(catalog.data.defaultModel);
  }, [catalog.data, modelId]);

  const history = useMemo(
    () => messages.map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  async function openConversation(id: string) {
    setActiveId(id);
    setError(null);
    setComparison(null);
    const result = await getFn({ data: { id } });
    setMessages(
      (result.messages ?? []).map((m) => ({
        id: m.id as string,
        role: m.role as "user" | "assistant",
        content: m.content as string,
      })),
    );
  }

  async function startNew() {
    const conv = await createFn({ data: { surface: "chat" } });
    await qc.invalidateQueries({ queryKey: ["conversations"] });
    requestHistoryRefresh();
    setActiveId((conv as { id: string }).id);
    setMessages([]);
    setComparison(null);
    track("chat_started");
  }

  function stop() {
    runRef.current += 1;
    setPending(false);
    toast("Generation stopped.");
  }

  async function regenerate() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || pending) return;
    setMessages((prev) => {
      const idx = prev.map((m) => m.role).lastIndexOf("assistant");
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
    await submit(lastUser.content, { keepUser: true });
  }

  async function submit(value: string, options?: { keepUser?: boolean }) {
    setError(null);
    if (compareMode) return runComparison(value);

    let conversationId = activeId;
    if (!conversationId) {
      const conv = await createFn({
        data: { surface: "chat", title: value.slice(0, 60) },
      });
      conversationId = (conv as { id: string }).id;
      setActiveId(conversationId);
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      requestHistoryRefresh();
    }

    const userMessage: UiMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: value,
    };
    if (!options?.keepUser) setMessages((prev) => [...prev, userMessage]);
    setPending(true);
    track("message_sent");
    runRef.current += 1;
    const run = runRef.current;

    try {
      // Streamed reply: the same request also persists both messages server-side.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/chat-stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          conversationId,
          content: value,
          history,
          ...(modelId ? { modelId } : {}),
        }),
      });
      if (run !== runRef.current) return;

      const replyId = `local-a-${Date.now()}`;
      let started = false;
      let failed = false;

      await readChatStream(res, {
        onDelta: (text) => {
          if (run !== runRef.current) return;
          if (!started) {
            started = true;
            setPending(false);
            setMessages((prev) => [
              ...prev,
              { id: replyId, role: "assistant", content: text },
            ]);
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === replyId ? { ...m, content: m.content + text } : m,
            ),
          );
        },
        onError: (failure) => {
          failed = true;
          if (run !== runRef.current) return;
          setError({ code: failure.code, message: failure.message });
          if (!started)
            setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
        },
      });

      if (run !== runRef.current || failed) return;
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      await qc.invalidateQueries({ queryKey: ["account"] });
    } catch {
      if (run !== runRef.current) return;
      setError({
        message: "The request could not be completed. Please try again.",
      });
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      if (run === runRef.current) setPending(false);
    }
  }

  async function runComparison(promptText: string) {
    const ids = [modelId, ...compareWith].filter(Boolean);
    if (ids.length < 2) {
      toast.error("Pick a second model to compare against.");
      return;
    }
    setPending(true);
    setComparison(null);
    try {
      const result = await compareFn({
        data: { prompt: promptText, modelIds: ids },
      });
      if (!result.ok) {
        setError({ code: result.code, message: result.message });
        return;
      }
      setComparison(result.results);
      await qc.invalidateQueries({ queryKey: ["account"] });
    } finally {
      setPending(false);
    }
  }

  // One user intent can only ever start one billable run, whatever the browser
  // or React does with the event (double click, remount, duplicated handler).
  const submitOnce = useSingleFlight((value: string) => submit(value));
  const regenerateOnce = useSingleFlight(() => regenerate());
  const starters = [
    "Research the history of Jagannath",
    "Write a practical business plan",
    "Explain this Sanskrit verse",
  ];

  return (
    <WorkspacePage
      width="full"
      className="flex min-h-full flex-col px-4 py-5 sm:px-6 lg:px-10"
    >
      <section className="mx-auto flex w-full min-w-0 max-w-4xl flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative inline-flex items-center">
            <span className="sr-only">Model</span>
            <select
              id="model"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="appearance-none rounded-full border border-border/70 bg-secondary/55 py-1.5 pl-3 pr-8 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {models.length === 0 ? (
                <option value="">No model configured</option>
              ) : null}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-muted-foreground" />
          </label>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={compareMode}
              onChange={(e) => {
                setCompareMode(e.target.checked);
                setComparison(null);
              }}
              className="h-4 w-4 rounded border-input"
            />
            Compare
          </label>
        </div>

        {compareMode ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {models
              .filter((m) => m.id !== modelId)
              .map((m) => {
                const on = compareWith.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() =>
                      setCompareWith((prev) =>
                        on
                          ? prev.filter((x) => x !== m.id)
                          : [...prev, m.id].slice(0, 2),
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      on
                        ? "border-ring bg-accent text-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
          </div>
        ) : null}

        <div className="flex min-h-[48vh] flex-1 flex-col justify-center py-8">
          {error ? (
            <ErrorState
              {...(error.code ? { code: error.code } : {})}
              message={error.message}
            />
          ) : null}

          {comparison ? (
            <div className="grid gap-3 md:grid-cols-2">
              {comparison.map((r) => (
                <div
                  key={r.modelId}
                  className="rounded-2xl border border-border bg-card p-4"
                >
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {r.modelId}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                    {r.ok ? r.message : r.error}
                  </p>
                </div>
              ))}
            </div>
          ) : messages.length === 0 && !pending ? (
            <div className="mx-auto w-full max-w-2xl text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-border/70 bg-secondary/45 text-primary">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </div>
              <h1 className="mt-5 text-balance text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
                What can I help you make sense of?
              </h1>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                Ask naturally. ACHYORA will use the real model configured for
                this workspace.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void submitOnce(starter)}
                    className="rounded-full border border-border/70 bg-secondary/35 px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageList
              messages={messages}
              pending={pending}
              {...(pending ? {} : { onRetry: () => void regenerateOnce() })}
            />
          )}

          {pending && comparison === null && compareMode ? (
            <LoadingState
              label="Running every selected model…"
              className="mt-4"
            />
          ) : null}
        </div>

        <div className="sticky bottom-0 mt-auto bg-gradient-to-t from-background via-background/95 to-transparent pb-2 pt-6">
          <Composer
            onSubmit={(v) => void submitOnce(v)}
            onStop={stop}
            busy={pending}
            disabled={models.length === 0}
            {...(prompt ? { initialValue: prompt } : {})}
            placeholder={
              compareMode
                ? "Prompt every selected model…"
                : "Ask ACHYORA anything…"
            }
            hint={
              compareMode
                ? "Comparison costs 1 credit per model."
                : "1 credit per message."
            }
          />
          <nav
            className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
            aria-label="Quick tools"
          >
            <a
              href="/workspace/library"
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Paperclip className="h-3.5 w-3.5" /> Library
            </a>
            <a
              href="/workspace/voice"
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Mic className="h-3.5 w-3.5" /> Voice
            </a>
          </nav>
        </div>
      </section>
    </WorkspacePage>
  );
}
