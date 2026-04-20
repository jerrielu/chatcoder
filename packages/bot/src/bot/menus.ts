import { InlineKeyboard } from "grammy";

export const CB = {
  newSession: "cc:new",
  newSessionConfirm: "cc:new:confirm",
  newSessionCancel: "cc:new:cancel",
  generateKey: "cc:new:gen",
  status: "cc:status",
  response: "cc:response",
  menu: "cc:menu"
} as const;

export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🆕 New Session", CB.newSession)
    .text("📡 Status", CB.status)
    .row()
    .text("📨 Response", CB.response);
}

export function confirmRotationMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Yes, revoke and create", CB.newSessionConfirm)
    .row()
    .text("❌ Cancel", CB.newSessionCancel);
}

export function keyChoiceMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎲 Generate for me", CB.generateKey)
    .row()
    .text("❌ Cancel", CB.newSessionCancel);
}

export function backToMenu(): InlineKeyboard {
  return new InlineKeyboard().text("« Menu", CB.menu);
}
