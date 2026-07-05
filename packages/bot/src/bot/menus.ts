import { InlineKeyboard } from "grammy";
import type { ProfileRecord } from "../db/profiles.js";
import { APP_VERSION } from "@chatcoder/shared";

export const CB = {
  code: "cc:code",
  newCode: "cc:newcode",
  latestProgress: "cc:latest",
  stop: "cc:stop",
  newSession: "cc:new",
  newSessionCancel: "cc:new:cancel",
  status: "cc:status",
  menu: "cc:menu",
  profileMenu: "cc:profmenu",
  folderMenu: "cc:foldermenu",
  /** Prefix for profile-pick callbacks: `cc:profile:<profileId>` */
  profilePrefix: "cc:profile:",
  /** Prefix for work-dir pick callbacks: `cc:wd:<index>` */
  workDirPrefix: "cc:wd:",
  /** Prefix for folder-menu pick callbacks: `cc:folder:<index>` */
  folderPrefix: "cc:folder:",
  /** Show version and changelog. */
  version: "cc:version"
} as const;

export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💻 Code", CB.code)
    .text("🆕 New Code", CB.newCode)
    .row()
    .text("👤 Profile", CB.profileMenu)
    .text("📁 Folder", CB.folderMenu)
    .row()
    .text("📋 Latest Progress", CB.latestProgress)
    .text("⏹ Stop", CB.stop)
    .row()
    .text("🆕 New Session", CB.newSession)
    .text("📡 Status", CB.status)
    .row()
    .text(`📦 v${APP_VERSION}`, CB.version);
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
    case "REASONIX":
      return "🔵";
    case "CUSTOM":
      return "🔧";
  }
}

export function parseProfileCallback(data: string): string | null {
  if (!data.startsWith(CB.profilePrefix)) return null;
  const id = data.slice(CB.profilePrefix.length);
  return id || null;
}

export function workDirPickerMenu(dirs: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < dirs.length; i++) {
    kb.text(`📁 ${dirs[i]!}`, CB.workDirPrefix + i).row();
  }
  kb.text("⏭ Skip (use default)", CB.workDirPrefix + "skip");
  return kb;
}

export function parseWorkDirCallback(
  data: string
): { index: number } | { skip: true } | null {
  if (!data.startsWith(CB.workDirPrefix)) return null;
  const val = data.slice(CB.workDirPrefix.length);
  if (val === "skip") return { skip: true };
  const idx = parseInt(val, 10);
  if (!isNaN(idx) && idx >= 0) return { index: idx };
  return null;
}

export function folderPickerMenu(dirs: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < dirs.length; i++) {
    kb.text(`📁 ${dirs[i]!}`, CB.folderPrefix + i).row();
  }
  kb.text("⏭ Use default", CB.folderPrefix + "default");
  kb.text("« Menu", CB.menu);
  return kb;
}

export function parseFolderCallback(
  data: string
): { index: number } | { useDefault: true } | null {
  if (!data.startsWith(CB.folderPrefix)) return null;
  const val = data.slice(CB.folderPrefix.length);
  if (val === "default") return { useDefault: true };
  const idx = parseInt(val, 10);
  if (!isNaN(idx) && idx >= 0) return { index: idx };
  return null;
}
