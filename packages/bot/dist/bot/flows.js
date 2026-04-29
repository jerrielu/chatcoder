const DEFAULT_CODEX_REASONING_EFFORT = "medium";
export class FlowStore {
    map = new Map();
    codexEffortMap = new Map();
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
    getCodexReasoningEffort(chatId, userId) {
        return (this.codexEffortMap.get(this.key(chatId, userId)) ??
            DEFAULT_CODEX_REASONING_EFFORT);
    }
    setCodexReasoningEffort(chatId, userId, effort) {
        this.codexEffortMap.set(this.key(chatId, userId), effort);
    }
}
//# sourceMappingURL=flows.js.map