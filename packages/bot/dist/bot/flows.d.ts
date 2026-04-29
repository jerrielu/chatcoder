import type { CodexReasoningEffort } from "@chatcoder/shared";
/**
 * Per-chat flow state for the grammY bot.
 *
 * The "new session" flow is now a two-step: ask for the daemon's API key,
 * then present a profile picker tied to that api_key.
 */
export type FlowState = {
    kind: "idle";
} | {
    kind: "awaiting_api_key";
} | {
    kind: "awaiting_profile";
    apiKeyId: string;
} | {
    kind: "awaiting_instruction";
    resumeLastSession: boolean;
};
export declare class FlowStore {
    private readonly map;
    private readonly codexEffortMap;
    private key;
    get(chatId: number, userId: number): FlowState;
    set(chatId: number, userId: number, s: FlowState): void;
    clear(chatId: number, userId: number): void;
    getCodexReasoningEffort(chatId: number, userId: number): CodexReasoningEffort;
    setCodexReasoningEffort(chatId: number, userId: number, effort: CodexReasoningEffort): void;
}
//# sourceMappingURL=flows.d.ts.map