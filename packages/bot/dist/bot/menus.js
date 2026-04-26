import { InlineKeyboard } from "grammy";
export const CB = {
    code: "cc:code",
    newCode: "cc:newcode",
    latestProgress: "cc:latest",
    tokenUsage: "cc:tokens",
    newSession: "cc:new",
    newSessionCancel: "cc:new:cancel",
    status: "cc:status",
    menu: "cc:menu",
    /** Prefix for profile-pick callbacks: `cc:profile:<profileId>` */
    profilePrefix: "cc:profile:"
};
export function mainMenu() {
    return new InlineKeyboard()
        .text("💻 Code", CB.code)
        .text("🆕 New Code", CB.newCode)
        .row()
        .text("📋 Latest Progress", CB.latestProgress)
        .text("🧮 Token Usage", CB.tokenUsage)
        .row()
        .text("🆕 New Session", CB.newSession)
        .text("📡 Status", CB.status);
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
export function toolIcon(tool) {
    switch (tool) {
        case "CLAUDE_CODE":
            return "🟣";
        case "OPENAI":
            return "🟢";
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
//# sourceMappingURL=menus.js.map