import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Plus, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";

export function Composer({
  onSubmit,
  onStop,
  busy = false,
  disabled = false,
  placeholder = "Ask ACHYORA anything…",
  autoFocus = false,
  hint,
  size = "lg",
  initialValue,
  attachments = true,
}: {
  onSubmit: (value: string) => void;
  onStop?: () => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  hint?: string;
  size?: "lg" | "md";
  initialValue?: string;
  attachments?: boolean;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill (e.g. a question handed over from another surface) is applied once
  // per distinct value and never clobbers what the user is currently typing.
  const lastPrefill = useRef<string | undefined>(initialValue);
  useEffect(() => {
    if (initialValue === undefined || initialValue === lastPrefill.current) return;
    lastPrefill.current = initialValue;
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || busy || disabled) return;
    setValue("");
    setFiles([]);
    onSubmit(trimmed);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div
        className={cn(
          "ach-glass group relative flex w-full items-end gap-2 rounded-2xl px-2.5 py-2.5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9)] transition-colors focus-within:border-ring/70",
          size === "lg" ? "sm:px-3 sm:py-3" : "",
          disabled && "opacity-60",
        )}
      >
        <label htmlFor="achyora-composer" className="sr-only">
          Message ACHYORA
        </label>

        {attachments ? (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                if (picked.length) setFiles((prev) => [...prev, ...picked].slice(0, 5));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              aria-label="Attach a file or photo"
              title="Attach a file or photo"
              className="mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-secondary/60 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Plus className="h-5 w-5" />
            </button>
          </>
        ) : null}

        <textarea
          id="achyora-composer"
          ref={ref}
          rows={1}
          autoFocus={autoFocus}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "max-h-[220px] w-full resize-none overflow-y-auto bg-transparent px-1 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            size === "lg" ? "text-base sm:text-[1.05rem]" : "text-sm sm:text-base",
          )}
        />
        {busy && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-secondary-foreground transition-colors hover:bg-accent"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || busy || value.trim().length === 0}
            aria-label="Send message"
            className="mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        )}
      </div>

      {files.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2 px-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-xs text-muted-foreground"
            >
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${f.name}`}
                className="shrink-0 transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {hint ? <p className="mt-2 px-1 text-xs text-muted-foreground">{hint}</p> : null}
    </form>
  );
}
