/**
 * Base URL of the bot admin API. At build time, can be overridden with
 * `VITE_BOT_API_URL`; at runtime the URL is read once at module load.
 * Default points at a bot running locally on the conventional port.
 */
export const BOT_API_URL: string =
  (import.meta.env.VITE_BOT_API_URL as string | undefined) ?? "http://127.0.0.1:8080";

/** Heartbeat age (ms) above which we mark a daemon "offline" in the UI. */
export const HEARTBEAT_STALE_MS = 60_000;
