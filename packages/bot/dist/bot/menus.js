import { InlineKeyboard } from "grammy";
import { CODEX_REASONING_EFFORTS } from "@chatcoder/shared";
export const CB = {
    code: "cc:code",
    newCode: "cc:newcode",
    latestProgress: "cc:latest",
    tokenUsage: "cc:tokens",
    codexEffortMenu: "cc:effort",
    newSession: "cc:new",
    newSessionCancel: "cc:new:cancel",
    status: "cc:status",
    menu: "cc:menu",
    profileMenu: "cc:profmenu",
    folderMenu: "cc:foldermenu",
    /** Prefix for Codex effort callbacks: `cc:effort:<effort>` */
    codexEffortPrefix: "cc:effort:",
    /** Prefix for profile-pick callbacks: `cc:profile:<profileId>` */
    profilePrefix: "cc:profile:",
    /** Prefix for work-dir pick callbacks: `cc:wd:<index>` */
    workDirPrefix: "cc:wd:",
    /** Prefix for folder-menu pick callbacks: `cc:folder:<index>` */
    folderPrefix: "cc:folder:"
};
export function mainMenu() {
    return new InlineKeyboard()
        .text("💻 Code", CB.code)
        .text("🆕 New Code", CB.newCode)
        .row()
        .text("👤 Profile", CB.profileMenu)
        .text("📁 Folder", CB.folderMenu)
        .row()
        .text("📋 Latest Progress", CB.latestProgress)
        .text("🧮 Token Usage", CB.tokenUsage)
        .row()
        .text("🆕 New Session", CB.newSession)
        .text("📡 Status", CB.status)
        .row()
        .text("🧠 Effort", CB.codexEffortMenu);
}
export function cancelMenu() {
    return new InlineKeyboard().text("❌ Cancel", CB.newSessionCancel);
}
export function profilePickerMenu(profiles) {
    const kb = new InlineKeyboard();
    for (const p of profiles) {
        kb.text(`${toolIcon(p.tool)} ${p.name}`, CB.profilePrefix + p.id).row();
    }
    kb.text("❌ Cancel", CB.newSessionCancel);
    return kb;
}
export function backToMenu() {
    return new InlineKeyboard().text("« Menu", CB.menu);
}
function effortLabel(effort, selected) {
    const base = effort === "xhigh" ? "XHigh" : effort[0].toUpperCase() + effort.slice(1);
    return effort === selected ? `✅ ${base}` : base;
}
export function codexEffortPickerMenu(selected) {
    const kb = new InlineKeyboard();
    const values = [...CODEX_REASONING_EFFORTS];
    for (let i = 0; i < values.length; i += 2) {
        const left = values[i];
        const right = values[i + 1];
        kb.text(effortLabel(left, selected), CB.codexEffortPrefix + left);
        if (right)
            kb.text(effortLabel(right, selected), CB.codexEffortPrefix + right);
        kb.row();
    }
    kb.text("« Menu", CB.menu);
    return kb;
}
export function toolIcon(tool) {
    switch (tool) {
        case "CLAUDE_CODE":
            return "🟣";
        case "OPENAI":
            return "🟢";
        case "REASONIX":
            return "🔵";
        case "CUSTOM":
            return "🔧";
    }
}
export function parseProfileCallback(data) {
    if (!data.startsWith(CB.profilePrefix))
        return null;
    const id = data.slice(CB.profilePrefix.length);
    return id || null;
}
export function parseCodexEffortCallback(data) {
    if (!data.startsWith(CB.codexEffortPrefix))
        return null;
    const effort = data.slice(CB.codexEffortPrefix.length);
    if (!CODEX_REASONING_EFFORTS.includes(effort)) {
        return null;
    }
    return effort;
}
export function workDirPickerMenu(dirs) {
    const kb = new InlineKeyboard();
    for (let i = 0; i < dirs.length; i++) {
        kb.text(`📁 ${dirs[i]}`, CB.workDirPrefix + i).row();
    }
    kb.text("⏭ Skip (use default)", CB.workDirPrefix + "skip");
    return kb;
}
export function parseWorkDirCallback(data) {
    if (!data.startsWith(CB.workDirPrefix))
        return null;
    const val = data.slice(CB.workDirPrefix.length);
    if (val === "skip")
        return { skip: true };
    const idx = parseInt(val, 10);
    if (!isNaN(idx) && idx >= 0)
        return { index: idx };
    return null;
}
export function folderPickerMenu(dirs) {
    const kb = new InlineKeyboard();
    for (let i = 0; i < dirs.length; i++) {
        kb.text(`📁 ${dirs[i]}`, CB.folderPrefix + i).row();
    }
    kb.text("⏭ Use default", CB.folderPrefix + "default");
    kb.text("« Menu", CB.menu);
    return kb;
}
export function parseFolderCallback(data) {
    if (!data.startsWith(CB.folderPrefix))
        return null;
    const val = data.slice(CB.folderPrefix.length);
    if (val === "default")
        return { useDefault: true };
    const idx = parseInt(val, 10);
    if (!isNaN(idx) && idx >= 0)
        return { index: idx };
    return null;
}
//# sourceMappingURL=menus.js.map