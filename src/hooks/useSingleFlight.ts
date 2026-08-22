import { useCallback, useEffect, useRef } from "react";

/**
 * Wraps an async action so that exactly one run can be in flight at a time.
 *
 * A billable action costs credits server-side, so the UI must never be able to
 * fire it twice from one user intent. React state (`busy`) only updates on the
 * next render, which still leaves a window for a double click, a duplicated
 * event handler or a fast retry. The ref below closes that window
 * synchronously: extra invocations while a run is active are dropped.
 *
 * A remount resets the guard, which is correct — the previous request belongs
 * to an unmounted tree and its result is discarded anyway.
 */
export function useSingleFlight<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown> | void,
): (...args: Args) => Promise<void> {
  const inFlight = useRef(false);
  const actionRef = useRef(action);
  const mounted = useRef(true);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return useCallback(async (...args: Args) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await actionRef.current(...args);
    } finally {
      inFlight.current = false;
    }
  }, []);
}
