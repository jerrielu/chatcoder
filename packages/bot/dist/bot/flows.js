/**
 * Per-chat flow state for the grammY bot.
 *
 * The "new session" flow is now a two-step: ask for the daemon's API key,
 * then present a profile picker tied to that api_key.
 */
export class FlowStore {
    map = new Map();
    key(chatId, userId) {
        return `${chatId}:${userId}`;
    }
    get(chatId, userId) {
        return this.map.get(this.key(chatId, userId)) ?? { kind: "idle" };
    }
    set(chatId, userId, s) {
        const k = this.key(chatId, userId);
        if (s.kind === "idle")
            this.map.delete(k);
        else
            this.map.set(k, s);
    }
    clear(chatId, userId) {
        this.map.delete(this.key(chatId, userId));
    }
}
//# sourceMappingURL=flows.js.map