export const CHAT_NEW_EVENT = "achyora:chat:new";
export const CHAT_OPEN_EVENT = "achyora:chat:open";
export const CHAT_HISTORY_REFRESH_EVENT = "achyora:chat:history-refresh";

export function requestNewChat() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHAT_NEW_EVENT));
}

export function requestOpenChat(id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail: { id } }));
}

export function requestHistoryRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHAT_HISTORY_REFRESH_EVENT));
}
