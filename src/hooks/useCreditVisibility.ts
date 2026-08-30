import { useCallback, useEffect, useState } from "react";

/**
 * "Show credit balance" is a *display* preference only.
 *
 * It never touches credit accounting: the server remains the single source of
 * truth for balances and deductions. Default is OFF so the workspace stays
 * uncluttered; turning it on simply reveals the balance the account already
 * reports.
 */
const STORAGE_KEY = "achyora.showCreditBalance";
const EVENT = "achyora:credit-visibility";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function useCreditVisibility(): {
  showCredits: boolean;
  setShowCredits: (next: boolean) => void;
} {
  // Starts false on both server and first client render, so hydration matches;
  // the stored preference is applied in an effect.
  const [showCredits, setShow] = useState(false);

  useEffect(() => {
    setShow(read());
    const sync = () => setShow(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setShowCredits = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* preference is best-effort only */
    }
    setShow(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { showCredits, setShowCredits };
}
