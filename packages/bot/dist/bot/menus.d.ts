import { InlineKeyboard } from "grammy";
import { type CodexReasoningEffort } from "@chatcoder/shared";
import type { ProfileRecord } from "../db/profiles.js";
export declare const CB: {
    readonly code: "cc:code";
    readonly newCode: "cc:newcode";
    readonly latestProgress: "cc:latest";
    readonly tokenUsage: "cc:tokens";
    readonly codexEffortMenu: "cc:effort";
    readonly newSession: "cc:new";
    readonly newSessionCancel: "cc:new:cancel";
    readonly status: "cc:status";
    readonly menu: "cc:menu";
    /** Prefix for Codex effort callbacks: `cc:effort:<effort>` */
    readonly codexEffortPrefix: "cc:effort:";
    /** Prefix for profile-pick callbacks: `cc:profile:<profileId>` */
    readonly profilePrefix: "cc:profile:";
};
export declare function mainMenu(): InlineKeyboard;
export declare function cancelMenu(): InlineKeyboard;
export declare function profilePickerMenu(profiles: ProfileRecord[]): InlineKeyboard;
export declare function backToMenu(): InlineKeyboard;
export declare function codexEffortPickerMenu(selected: CodexReasoningEffort): InlineKeyboard;
export declare function toolIcon(tool: ProfileRecord["tool"]): string;
export declare function parseProfileCallback(data: string): string | null;
export declare function parseCodexEffortCallback(data: string): CodexReasoningEffort | null;
//# sourceMappingURL=menus.d.ts.map