/**
 * Pure handlers for the Telegram bot. Each receives `deps` + the relevant
 * pieces of the incoming update and returns the reply(s) the bot should send.
 */
import type { InlineKeyboard } from "grammy";
import type { ApiKeysRepo } from "../db/apiKeys.js";
import type { ProfilesRepo } from "../db/profiles.js";
import type { SessionsRepo } from "../db/sessions.js";
import type { MessagesRepo } from "../db/messages.js";
import type { FlowStore } from "./flows.js";
export interface Reply {
    text: string;
    keyboard?: InlineKeyboard;
    forceReply?: boolean;
    inputPlaceholder?: string;
    parseMode?: "Markdown" | "HTML";
}
export interface HandlerDeps {
    apiKeys: ApiKeysRepo;
    profiles: ProfilesRepo;
    sessions: SessionsRepo;
    messages: MessagesRepo;
    flows: FlowStore;
    /** Heartbeat age (ms) above which the daemon is shown as offline. */
    heartbeatStaleMs?: number;
    now?: () => number;
}
export declare function handleStart(): Reply;
export declare function handleMenu(): Reply;
export declare function handleLatestProgress(deps: HandlerDeps, chatId: number): Promise<Reply>;
export declare function handleTokenUsage(deps: HandlerDeps, chatId: number): Promise<Reply>;
export declare function handleStatus(deps: HandlerDeps, chatId: number): Promise<Reply>;
export declare function handleNewSessionRequest(deps: HandlerDeps, chatId: number, telegramUser: number): Reply;
export declare function handleNewSessionCancel(deps: HandlerDeps, chatId: number, telegramUser: number): Reply;
/**
 * Called when the user sends a text message while in the `awaiting_api_key`
 * state. Looks up the daemon by api_key hash, validates it has profiles,
 * and transitions to `awaiting_profile` with a picker.
 *
 * Returns null if the user isn't in this flow (so the plain-text fallback
 * can take over).
 */
export declare function handleApiKeySubmission(deps: HandlerDeps, chatId: number, telegramUser: number, text: string): Promise<Reply | null>;
export declare function handleProfilePicked(deps: HandlerDeps, chatId: number, telegramUser: number, profileId: string): Promise<Reply>;
export declare function handleCodeRequest(deps: HandlerDeps, chatId: number, telegramUser: number): Reply;
export declare function handleNewCodeRequest(deps: HandlerDeps, chatId: number, telegramUser: number): Reply;
export declare function handleInstructionSubmission(deps: HandlerDeps, chatId: number, telegramUser: number, text: string): Promise<Reply | null>;
export declare function handleCode(deps: HandlerDeps, chatId: number, instruction: string, resumeLastSession?: boolean): Promise<Reply>;
export declare function handlePlainText(): Reply;
//# sourceMappingURL=handlers.d.ts.map