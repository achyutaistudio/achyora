import { Copy, RotateCcw, Check } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function MessageList({
  messages,
  pending,
  onRetry,
  className,
}: {
  messages: UiMessage[];
  pending?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn("flex flex-col gap-6", className)}
      role="log"
      aria-live="polite"
    >
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} {...(onRetry ? { onRetry } : {})} />
      ))}
      {pending ? <TypingIndicator /> : null}
    </div>
  );
}

function MessageRow({
  message,
  onRetry,
}: {
  message: UiMessage;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[min(46rem,100%)]",
          isUser && "max-w-[min(34rem,100%)]",
        )}
      >
        {!isUser ? (
          <p className="mb-1.5 text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
            ACHYORA
          </p>
        ) : null}
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-[0.95rem] leading-relaxed",
            isUser
              ? "bg-secondary text-secondary-foreground"
              : "border border-border bg-card text-card-foreground",
          )}
        >
          {message.content}
        </div>
        {!isUser ? (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Regenerate
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5" aria-label="ACHYORA is thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-primary"
          style={{
            animation: `ach-breathe 1.4s ease-in-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
