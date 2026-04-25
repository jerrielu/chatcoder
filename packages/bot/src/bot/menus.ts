import { InlineKeyboard } from "grammy";
import type { ProfileRecord } from "../db/profiles.js";

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
} as const;

export function mainMenu(): InlineKeyboard {
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

export function cancelMenu(): InlineKeyboard {
  return new InlineKeyboard().text("❌ Cancel", CB.newSessionCancel);
}

export function profilePickerMenu(profiles: ProfileRecord[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of profiles) {
    kb.text(`${toolIcon(p.tool)} ${p.name}`, CB.profilePrefix + p.id).row();
  }
  kb.text("❌ Cancel", CB.newSessionCancel);
  return kb;
}

export function backToMenu(): InlineKeyboard {
  return new InlineKeyboard().text("« Menu", CB.menu);
}

export function toolIcon(tool: ProfileRecord["tool"]): string {
  switch (tool) {
    case "CLAUDE_CODE":
      return "🟣";
    case "OPENAI":
      return "🟢";
    case "CUSTOM":
      return "🔧";
  }
}

export function parseProfileCallback(data: string): string | null {
  if (!data.startsWith(CB.profilePrefix)) return null;
  const id = data.slice(CB.profilePrefix.length);
  return id || null;
}
