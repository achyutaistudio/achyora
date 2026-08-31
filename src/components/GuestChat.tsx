import { Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

import { Composer } from "@/components/Composer";
import { MessageList, type UiMessage } from "@/components/MessageList";
import { ErrorState } from "@/components/States";
import { readChatStream } from "@/lib/ai/stream-client";
import { track } from "@/lib/analytics";
import type { ErrorCode } from "@/lib/errors";

const EXAMPLES = [
  "Explain the difference between dharma and duty",
  "Draft a calm reply to a difficult client email",
  "Summarise this quarter's priorities into three decisions",
  "What should I understand about Vedanta before reading the Upanishads?",
];

type Failure = { code: ErrorCode | string; message: string };

export function GuestChat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  const send = useCallback(async (text: string, history: UiMessage[]) => {
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/public/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [...history, { role: "user", content: text }].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: controller.signal,
      });

      // One assistant bubble is created on the first token and then grown in
      // place, so nothing is ever duplicated when the stream fails midway.
      const replyId = crypto.randomUUID();
      let started = false;

      await readChatStream(res, {
        onDelta: (text) => {
          if (!started) {
            started = true;
            setBusy(false);
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
        onDone: (meta) => {
          if (typeof meta["remaining"] === "number")
            setRemaining(meta["remaining"] as number);
        },
        onError: (failure) => {
          if (failure.code === "GUEST_LIMIT_REACHED") {
            setLimitReached(true);
            setRemaining(0);
            track("guest_limit_reached");
            return;
          }
          setError({
            code: failure.code as ErrorCode,
            message: failure.message,
          });
        },
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError({
        code: "UNKNOWN",
        message: "The connection dropped. Please try again.",
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, []);

  function handleSubmit(text: string) {
    if (!startedRef.current) {
      startedRef.current = true;
      track("guest_chat_started");
    }
    track("guest_message_sent");
    const history = messages;
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text },
    ]);
    void send(text, history);
  }

  function retry() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const history = messages.slice(
      0,
      messages.findIndex((m) => m.id === lastUser.id),
    );
    void send(lastUser.content, history);
  }

  return (
    <div className="w-full">
      {messages.length > 0 ? (
        <div className="mb-6 max-h-[52vh] overflow-y-auto pr-1">
          <MessageList
            messages={messages}
            pending={busy}
            onRetry={busy ? undefined : retry}
          />
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <ErrorState
            code={error.code}
            message={error.message}
            onRetry={retry}
          />
        </div>
      ) : null}

      {limitReached ? (
        <div className="ach-glass rounded-2xl px-5 py-6 text-center">
          <h2 className="text-lg text-foreground" style={{ fontWeight: 700 }}>
            Continue your conversation with ACHYORA
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Create a free account to keep chatting, save conversations and
            unlock the workspace.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
              style={{ fontWeight: 600 }}
            >
              Create account
            </Link>
            <Link
              to="/auth"
              search={{ mode: "signin" }}
              className="rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-secondary-foreground transition-colors hover:bg-accent"
              style={{ fontWeight: 600 }}
            >
              Sign in
            </Link>
          </div>
        </div>
      ) : (
        <Composer
          onSubmit={handleSubmit}
          busy={busy}
          onStop={() => abortRef.current?.abort()}
          autoFocus
          placeholder="Ask ACHYORA anything…"
          hint={
            remaining === null
              ? "10 free messages every 24 hours. No account needed to start."
              : `${remaining} free ${remaining === 1 ? "message" : "messages"} left today.`
          }
        />
      )}

      {messages.length === 0 && !limitReached ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => handleSubmit(example)}
              className="rounded-full border border-border bg-secondary/60 px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground sm:text-[0.8rem]"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
