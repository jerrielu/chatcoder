import { useEffect, useRef, useState } from "react";

/**
 * Run `fn()` once and then every `intervalMs` until unmounted or deps change.
 * Exposes `data`, `error`, `refresh()`, and a `loading` flag for the first
 * fetch. Re-polls skip the loading state so the UI doesn't flicker.
 */
export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  deps: readonly unknown[]
): { data: T | null; error: Error | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    let first = true;
    const run = async (): Promise<void> => {
      try {
        const next = await fnRef.current();
        if (cancelled) return;
        setData(next);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (first && !cancelled) setLoading(false);
        first = false;
      }
    };
    setLoading(true);
    void run();
    const timer = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs, tick, ...deps]);

  return { data, error, loading, refresh: () => setTick((x) => x + 1) };
}
