import { InlineKeyboard } from "grammy";
import {
  CODEX_REASONING_EFFORTS,
  type CodexReasoningEffort
} from "@chatcoder/shared";
import type { ProfileRecord } from "../db/profiles.js";

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
  /** Prefix for Codex effort callbacks: `cc:effort:<effort>` */
  codexEffortPrefix: "cc:effort:",
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
    .text("📡 Status", CB.status)
    .row()
    .text("🧠 Effort", CB.codexEffortMenu);
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

function effortLabel(
  effort: CodexReasoningEffort,
  selected: CodexReasoningEffort
): string {
  const base = effort === "xhigh" ? "XHigh" : effort[0]!.toUpperCase() + effort.slice(1);
  return effort === selected ? `✅ ${base}` : base;
}

export function codexEffortPickerMenu(
  selected: CodexReasoningEffort
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const values = [...CODEX_REASONING_EFFORTS];
  for (let i = 0; i < values.length; i += 2) {
    const left = values[i]!;
    const right = values[i + 1];
    kb.text(effortLabel(left, selected), CB.codexEffortPrefix + left);
    if (right) kb.text(effortLabel(right, selected), CB.codexEffortPrefix + right);
    kb.row();
  }
  kb.text("« Menu", CB.menu);
  return kb;
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

export function parseCodexEffortCallback(
  data: string
): CodexReasoningEffort | null {
  if (!data.startsWith(CB.codexEffortPrefix)) return null;
  const effort = data.slice(CB.codexEffortPrefix.length);
  if (!CODEX_REASONING_EFFORTS.includes(effort as CodexReasoningEffort)) {
    return null;
  }
  return effort as CodexReasoningEffort;
}
