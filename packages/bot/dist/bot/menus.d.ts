import { InlineKeyboard } from "grammy";
import type { ProfileRecord } from "../db/profiles.js";
export declare const CB: {
    readonly code: "cc:code";
    readonly newCode: "cc:newcode";
    readonly latestProgress: "cc:latest";
    readonly stop: "cc:stop";
    readonly newSession: "cc:new";
    readonly newSessionCancel: "cc:new:cancel";
    readonly status: "cc:status";
    readonly menu: "cc:menu";
    readonly profileMenu: "cc:profmenu";
    readonly folderMenu: "cc:foldermenu";
    /** Prefix for profile-pick callbacks: `cc:profile:<profileId>` */
    readonly profilePrefix: "cc:profile:";
    /** Prefix for work-dir pick callbacks: `cc:wd:<index>` */
    readonly workDirPrefix: "cc:wd:";
    /** Prefix for folder-menu pick callbacks: `cc:folder:<index>` */
    readonly folderPrefix: "cc:folder:";
    /** Show version and changelog. */
    readonly version: "cc:version";
};
export declare function mainMenu(): InlineKeyboard;
export declare function cancelMenu(): InlineKeyboard;
export declare function profilePickerMenu(profiles: ProfileRecord[]): InlineKeyboard;
export declare function backToMenu(): InlineKeyboard;
export declare function toolIcon(tool: ProfileRecord["tool"]): string;
export declare function parseProfileCallback(data: string): string | null;
export declare function workDirPickerMenu(dirs: string[]): InlineKeyboard;
export declare function parseWorkDirCallback(data: string): {
    index: number;
} | {
    skip: true;
} | null;
export declare function folderPickerMenu(dirs: string[]): InlineKeyboard;
export declare function parseFolderCallback(data: string): {
    index: number;
} | {
    useDefault: true;
} | null;
//# sourceMappingURL=menus.d.ts.map