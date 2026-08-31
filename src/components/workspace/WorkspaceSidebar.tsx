import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  FolderClosed,
  Image as ImageIcon,
  Library,
  MessageSquarePlus,
  MoreHorizontal,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Telescope,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AchyoraMark } from "@/components/brand/AchyoraMark";
import { SidebarUser } from "@/components/workspace/SidebarUser";
import {
  CHAT_HISTORY_REFRESH_EVENT,
  requestNewChat,
  requestOpenChat,
} from "@/components/workspace/chat-events";
import { listConversations } from "@/lib/achyora.functions";
import { cn } from "@/lib/utils";

const PRIMARY_NAV = [
  { to: "/workspace/chat", label: "Chat", icon: MessageSquarePlus },
  { to: "/workspace/image", label: "Image", icon: ImageIcon },
  { to: "/workspace/library", label: "Library", icon: FolderClosed },
  {
    to: "/workspace/sanatan",
    label: "Sanatan",
    icon: BookOpenText,
    avatar: true,
  },
] as const;

const MORE_NAV = [
  { to: "/workspace/voice", label: "Voice", icon: Mic },
  { to: "/workspace/research", label: "Research", icon: Telescope },
] as const;

const ITEM_BASE =
  "group/nav relative flex w-full items-center rounded-xl text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const ITEM_ACTIVE = "bg-sidebar-accent text-sidebar-accent-foreground";

function NavItem({
  to,
  label,
  icon: Icon,
  collapsed,
  onNavigate,
  avatar = false,
}: {
  to: string;
  label: string;
  icon: typeof MessageSquarePlus;
  collapsed: boolean;
  onNavigate?: () => void;
  avatar?: boolean;
}) {
  return (
    <li>
      <Link
        to={to}
        title={collapsed ? label : undefined}
        onClick={onNavigate}
        className={cn(
          ITEM_BASE,
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
        )}
        activeProps={{
          className: cn(
            ITEM_BASE,
            ITEM_ACTIVE,
            collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
          ),
        }}
      >
        {avatar ? (
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-secondary/80",
              collapsed && "h-8 w-8",
            )}
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </span>
        ) : (
          <Icon
            className="h-[1.05rem] w-[1.05rem] shrink-0"
            aria-hidden="true"
          />
        )}
        {collapsed ? (
          <span className="sr-only">{label}</span>
        ) : (
          <span>{label}</span>
        )}
      </Link>
    </li>
  );
}

function NewChatButton({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        requestNewChat();
        onNavigate?.();
      }}
      title={collapsed ? "New chat" : undefined}
      className={cn(
        "flex w-full items-center rounded-xl border border-primary/25 bg-primary/10 text-sm text-foreground shadow-sm transition-colors hover:bg-primary/15",
        collapsed
          ? "justify-center px-0 py-2.5"
          : "justify-start gap-2 px-3 py-2.5",
      )}
      style={{ fontWeight: 650 }}
    >
      <MessageSquarePlus
        className="h-[1.05rem] w-[1.05rem] shrink-0"
        aria-hidden="true"
      />
      {collapsed ? (
        <span className="sr-only">New chat</span>
      ) : (
        <span>New chat</span>
      )}
    </button>
  );
}

function HistorySection({ collapsed }: { collapsed: boolean }) {
  const listFn = useServerFn(listConversations);
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listFn(),
  });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const refresh = () => void conversations.refetch();
    window.addEventListener(CHAT_HISTORY_REFRESH_EVENT, refresh);
    return () =>
      window.removeEventListener(CHAT_HISTORY_REFRESH_EVENT, refresh);
  }, [conversations]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = conversations.data ?? [];
    return q
      ? source.filter((c) =>
          String(c.title ?? "")
            .toLowerCase()
            .includes(q),
        )
      : source;
  }, [conversations.data, query]);

  if (collapsed) {
    return (
      <button
        type="button"
        title="History"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center rounded-xl py-2.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Library className="h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
        <span className="sr-only">History</span>
      </button>
    );
  }

  return (
    <section className="mt-3 min-h-0 flex-1 border-t border-sidebar-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2 py-1 text-[0.68rem] uppercase tracking-[0.16em] text-muted-foreground"
        aria-expanded={open}
      >
        <span>History</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <>
          <div className="relative mt-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <label htmlFor="workspace-history-search" className="sr-only">
              Search history
            </label>
            <input
              id="workspace-history-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-xl border border-input bg-secondary/50 py-1.5 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:border-ring"
            />
          </div>

          <div className="mt-2 max-h-[min(34vh,20rem)] overflow-y-auto pr-1">
            {rows.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {query.trim() ? "No matching chats." : "No chats yet."}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {rows.map((conversation) => (
                  <li
                    key={conversation.id}
                    className="group/history flex items-center gap-1"
                  >
                    <button
                      type="button"
                      onClick={() => requestOpenChat(String(conversation.id))}
                      className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      title={String(conversation.title ?? "Untitled")}
                    >
                      {String(conversation.title ?? "Untitled")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * The single workspace navigation surface. Chat history now lives inside the
 * same rail, so the chat page can use the entire main canvas. Video is kept in
 * the backend/routes but deliberately hidden from this navigation until it is
 * explicitly enabled later.
 */
export function WorkspaceSidebar({
  collapsed,
  onToggle,
  user,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  user: User | null;
  onNavigate?: () => void;
}) {
  const [collapsedMoreOpen, setCollapsedMoreOpen] = useState(false);

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border/70 bg-sidebar/95 backdrop-blur-xl",
        collapsed ? "px-2 py-4" : "px-3 py-4",
      )}
    >
      <div
        className={cn(
          "flex items-center",
          collapsed ? "justify-center" : "gap-2.5 px-1",
        )}
      >
        <Link
          to="/workspace/chat"
          aria-label="ACHYORA workspace"
          className="shrink-0"
        >
          <AchyoraMark className="h-8 w-8" />
        </Link>
        {collapsed ? null : (
          <span
            className="ach-titanium-text text-[0.92rem] tracking-[0.22em]"
            style={{ fontWeight: 800 }}
          >
            ACHYORA
          </span>
        )}
      </div>

      <nav
        aria-label="Workspace"
        className="relative mt-7 min-h-0 flex flex-1 flex-col overflow-visible"
      >
        <NewChatButton
          collapsed={collapsed}
          {...(onNavigate ? { onNavigate } : {})}
        />

        <ul className={cn("space-y-0.5", collapsed ? "mt-3" : "mt-3")}>
          {PRIMARY_NAV.map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              label={item.label}
              icon={item.icon}
              collapsed={collapsed}
              {...("avatar" in item ? { avatar: item.avatar } : {})}
              {...(onNavigate ? { onNavigate } : {})}
            />
          ))}
        </ul>

        {collapsed ? (
          <div className="relative mt-2">
            <button
              type="button"
              title="More"
              aria-label="More workspace tools"
              aria-expanded={collapsedMoreOpen}
              onClick={() => setCollapsedMoreOpen((v) => !v)}
              className="flex w-full items-center justify-center rounded-xl py-2.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <MoreHorizontal
                className="h-[1.05rem] w-[1.05rem]"
                aria-hidden="true"
              />
            </button>
            {collapsedMoreOpen ? (
              <div className="absolute left-[calc(100%+0.5rem)] top-0 z-50 w-48 rounded-xl border border-sidebar-border bg-popover p-1.5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]">
                {MORE_NAV.map((item) => (
                  <NavItem
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    icon={item.icon}
                    collapsed={false}
                    {...(onNavigate
                      ? {
                          onNavigate: () => {
                            setCollapsedMoreOpen(false);
                            onNavigate();
                          },
                        }
                      : { onNavigate: () => setCollapsedMoreOpen(false) })}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {!collapsed ? (
          <div className="mt-2">
            <details className="group/more">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="h-4 w-4 transition-transform group-open/more:rotate-90"
                  aria-hidden="true"
                />
                <span>More</span>
              </summary>
              <ul className="mt-1 space-y-0.5 pl-2">
                {MORE_NAV.map((item) => (
                  <NavItem
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    icon={item.icon}
                    collapsed={false}
                    {...(onNavigate ? { onNavigate } : {})}
                  />
                ))}
              </ul>
            </details>
          </div>
        ) : null}

        <HistorySection collapsed={collapsed} />
      </nav>

      <div className="mt-4 space-y-1 border-t border-sidebar-border pt-3">
        <ul>
          <NavItem
            to="/workspace/settings"
            label="Settings"
            icon={Settings}
            collapsed={collapsed}
            {...(onNavigate ? { onNavigate } : {})}
          />
        </ul>

        {user ? <SidebarUser user={user} collapsed={collapsed} /> : null}

        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "hidden w-full items-center rounded-xl py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:flex",
            collapsed ? "justify-center" : "gap-3 px-3",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen
              className="h-[1.05rem] w-[1.05rem]"
              aria-hidden="true"
            />
          ) : (
            <>
              <PanelLeftClose
                className="h-[1.05rem] w-[1.05rem]"
                aria-hidden="true"
              />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
