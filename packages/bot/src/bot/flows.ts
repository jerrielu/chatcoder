/**
 * Per-chat flow state for the grammY bot.
 *
 * The "new session" flow is now a two-step: ask for the daemon's API key,
 * then present a profile picker tied to that api_key.
 */

export type FlowState =
  | { kind: "idle" }
  | { kind: "awaiting_api_key" }
  | { kind: "awaiting_profile"; apiKeyId: string }
  | { kind: "awaiting_instruction"; resumeLastSession: boolean };

export class FlowStore {
  private readonly map = new Map<string, FlowState>();

  private key(chatId: number, userId: number): string {
    return `${chatId}:${userId}`;
  }

  get(chatId: number, userId: number): FlowState {
    return this.map.get(this.key(chatId, userId)) ?? { kind: "idle" };
  }
  set(chatId: number, userId: number, s: FlowState): void {
    const k = this.key(chatId, userId);
    if (s.kind === "idle") this.map.delete(k);
    else this.map.set(k, s);
  }
  clear(chatId: number, userId: number): void {
    this.map.delete(this.key(chatId, userId));
  }
}
