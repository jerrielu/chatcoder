/**
 * Per-chat flow state for the grammY bot.
 *
 * The flows are short (≤3 steps) so we keep them in-process. If we ever run
 * multiple bot replicas we'll need to move this to the DB — but telegram
 * long-polling already constrains us to a single bot replica, so this is fine.
 */

export type FlowState =
  | { kind: "idle" }
  | { kind: "confirming_rotation" }
  | { kind: "awaiting_rotation_key" };

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
