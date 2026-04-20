/**
 * Fallback API URL shown in the Telegram session hand-off when
 * `BOT_PUBLIC_URL` isn't set. `0.0.0.0` binds every interface but isn't a
 * valid destination, so swap it for `localhost`; the IPv6 wildcard `::`
 * gets the same treatment.
 */
export function deriveLocalApiUrl(host: string, port: number): string {
  const displayHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  return `http://${displayHost}:${port}`;
}
