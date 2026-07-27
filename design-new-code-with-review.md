# Design: New Code (with Review) Menu Item

## Overview

新增一个 Telegram Menu Item **"🆕 New Code (with Review)"**，功能是：

1. 用户输入指令（同 New Code）
2. Bot 自动将指令与一个额外的 **code review prompt** 组合
3. 组合后的完整指令发送给 daemon 执行（fresh session，`resumeLastSession=false`）

用户指令传给 New Code 功能的同时，附加一个 prompt 让 AI 对上一次 commit 做深度 Code Review，确保代码符合 SOLID 等工程原则，并且实现了用户要求的功能。

---

## Expected Behaviour

1. 用户点击 `🆕 New Code (with Review)` 按钮
2. Bot 回复 force-reply 提示用户输入指令
3. 用户输入指令（例如 "Add a login page"）
4. Bot 将以下组合指令发送给 daemon（fresh session）:

```
Deep Dive Code Review on the previous commit and uncommitted changes to make sure it
complies with the software engineering principles such as SOLID, and it can achieve what
user asked: {user instruction}
```

5. Daemon 在 fresh session 中执行该组合指令
6. AI 先做 code review（覆盖 previous commit + uncommitted changes），然后根据 review 结果执行用户的指令
7. 结果正常返回给用户（与其他指令相同的回复流程）

---

## Design Decisions

### Decision 1: How to pass the review prompt to the daemon

**Options considered**

| # | Option | Pros | Cons |
|---|--------|------|------|
| A | **Bot-side prompt composition (chosen)** | Zero daemon changes; prompt is just a string; easy to modify prompt template | Prompt is opaque to daemon; no special logging |
| B | New `kind: "review"` field on messages table | Explicit semantics; daemon could handle review differently | Schema change; daemon change; over-engineering for a prompt prepend |
| C | Daemon-side prompt injection | Prompt logic lives with execution context | Tight coupling; requires daemon code change for a bot-level feature |

**Chosen: A.** The review prompt is just a text string prepended to the user's instruction. The daemon and CLI tools don't need to know it's a "review" — they just receive a combined instruction. This keeps the change **entirely in the bot package** with zero schema or daemon modifications.

---

### Decision 2: How to extend the flow state

**Options considered**

| # | Option | Pros | Cons |
|---|--------|------|------|
| A | **New `review?: boolean` field on `awaiting_instruction` (chosen)** | Minimal type change; `review` defaults to `undefined`/`false` for existing flows; backward-compatible | Adds one field to the union |
| B | New flow state `awaiting_review_instruction` | Fully explicit | Duplicates `awaiting_instruction` logic; requires parallel handling everywhere |
| C | Separate in-memory flag outside FlowStore | No type change | Scattered state; harder to reason about; recovery logic needs extra state |

**Chosen: A.** Adding `review?: boolean` to the existing `awaiting_instruction` state is the smallest change. The `handleInstructionSubmission` function checks this flag to decide whether to compose the review prompt.

---

### Decision 3: Menu placement

**Options considered**

| # | Option | Pros | Cons |
|---|--------|------|------|
| A | **Third button in the first row: `Code \| New Code \| New Code+Review` (chosen)** | All code-related actions are together; visually grouped | First row has 3 buttons (slightly wider) |
| B | Second row, below Code/New Code | Clear visual separation | Separates related actions |
| C | Sub-menu under "New Code" | Keeps main menu compact | Extra tap; less discoverable |

**Chosen: A.** The button label will be `🔬 New Code + Review` to keep it concise. Three buttons in the first row is acceptable for inline keyboards.

---

## Implementation Plan

### 1. Extend FlowState type (`packages/bot/src/bot/flows.ts`)

Add `review?: boolean` to the `awaiting_instruction` variant:

```typescript
export type FlowState =
  | { kind: "idle" }
  | { kind: "awaiting_api_key" }
  | { kind: "awaiting_profile"; apiKeyId: string }
  | { kind: "awaiting_profile_menu"; apiKeyId: string }
  | { kind: "awaiting_workdir"; apiKeyId: string; profileId: string }
  | { kind: "awaiting_instruction"; resumeLastSession: boolean; review?: boolean };
```

The `review` field is optional — when absent or `false`, behaviour is identical to today.

### 2. Add callback constant and menu button (`packages/bot/src/bot/menus.ts`)

Add to `CB`:

```typescript
newCodeReview: "cc:newcode:review"
```

Add button to `mainMenu()` — first row becomes:

```typescript
.text("💻 Code", CB.code)
.text("🆕 New Code", CB.newCode)
.text("🔬 New Code + Review", CB.newCodeReview)
.row()
```

### 3. Add handler (`packages/bot/src/bot/handlers.ts`)

New `handleNewCodeReviewRequest` function:

```typescript
export function handleNewCodeReviewRequest(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number
): Reply {
  deps.flows.set(chatId, telegramUser, {
    kind: "awaiting_instruction",
    resumeLastSession: false,
    review: true
  });
  return {
    text:
      "🔬 *New Code (with Review)*\n\n" +
      "Enter the instruction for your daemon. This will start a fresh CLI run\n" +
      "and perform a deep code review on the previous commit and uncommitted changes.\n\n" +
      "Reply with the instruction, or send `/cancel` to abort.",
    forceReply: true,
    inputPlaceholder: "Describe the code change",
    parseMode: "Markdown"
  };
}
```

### 4. Modify `handleInstructionSubmission` (`packages/bot/src/bot/handlers.ts`)

When `state.review === true`, compose the review prompt:

```typescript
export async function handleInstructionSubmission(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number,
  text: string
): Promise<Reply | null> {
  const state = deps.flows.get(chatId, telegramUser);
  if (state.kind !== "awaiting_instruction") return null;

  const instruction = text.trim();
  if (instruction.length === 0) {
    return {
      text: "❌ Instruction cannot be empty. Enter a message or send `/cancel`.",
      parseMode: "Markdown"
    };
  }

  // Compose the final instruction — prepend review prompt if in review mode
  let finalInstruction = instruction;
  if (state.review) {
    finalInstruction =
      `Deep Dive Code Review on the previous commit and uncommitted changes to make sure ` +
      `it complies with the software engineering principles such as SOLID, and it can achieve ` +
      `what user asked: ${instruction}`;
  }

  if (finalInstruction.length > MAX_INSTRUCTION_BYTES) {
    return {
      text:
        `❌ Instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes.\n` +
        "Send a shorter instruction or `/cancel`.",
      parseMode: "Markdown"
    };
  }

  const codexReasoningEffort = deps.flows.getCodexReasoningEffort(chatId, telegramUser);
  const reply = await handleCode(
    deps,
    chatId,
    finalInstruction,
    state.resumeLastSession,
    codexReasoningEffort
  );
  deps.flows.clear(chatId, telegramUser);
  return reply;
}
```

### 5. Wire callback in `bot.ts` (`packages/bot/src/bot/bot.ts`)

```typescript
bot.callbackQuery(CB.newCodeReview, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.chat || !ctx.from) return;
  await send(ctx, handleNewCodeReviewRequest(deps, ctx.chat.id, ctx.from.id));
});
```

### 6. Update `recoverInstructionMode` (`packages/bot/src/bot/bot.ts`)

Handle reply-based recovery for the new prompt text:

```typescript
function recoverInstructionMode(ctx: Context): boolean | null {
  const prompt = ctx.message?.reply_to_message;
  if (!prompt?.from?.is_bot || !("text" in prompt) || typeof prompt.text !== "string") {
    return null;
  }
  if (prompt.text.includes("Code (resume)")) return true;
  if (prompt.text.includes("New Code (fresh)")) return false;
  if (prompt.text.includes("New Code (with Review)")) return false;
  return null;
}
```

Note: Review recovery sets `resumeLastSession: false` (same as New Code). The `review` flag is lost on recovery, but this is acceptable — the user already received the review prompt text, so the instruction they type is likely still review-oriented. If strict review recovery is needed later, we can extend `recoverInstructionMode` to also detect the review flag.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/bot/src/bot/flows.ts` | Add `review?: boolean` to `awaiting_instruction` state |
| `packages/bot/src/bot/menus.ts` | Add `CB.newCodeReview` callback constant + button |
| `packages/bot/src/bot/handlers.ts` | Add `handleNewCodeReviewRequest()`; modify `handleInstructionSubmission()` for review prompt composition |
| `packages/bot/src/bot/bot.ts` | Wire `CB.newCodeReview` callback; update `recoverInstructionMode()` |

---

## Post-Change Automation

Per AGENTS.md, after implementation:

1. **Update version** — Bump patch version in all `package.json` files (minor if considered a new feature)
2. **Update `changes.md`** — Add entry for new menu item
3. **Update `design.md`** — Add section about New Code (with Review) feature
4. **Update `README.md`** — Document the new menu item
5. **Commit and push**
6. **Restart** — `npm run local`
