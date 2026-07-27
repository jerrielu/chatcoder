# Design: New Code (with Review) Menu Item

## Overview

新增一个 Telegram Menu Item **"🆕 New Code (with Review)"**，功能是：

1. 用户输入指令（同 New Code）
2. Bot 先将用户指令本身作为一个 fresh run 发送给 daemon
3. Bot 再将一个 **code review prompt** 作为另一个 fresh run 发送给 daemon
4. 用户指令先执行，然后 review 指令自动对上一次 commit 做深度 Code Review，确保代码符合 SOLID 等工程原则，并且实现了用户要求的功能，最后修复发现的所有问题。

这样 AI 先实现功能，再独立进行 review + fix，形成清晰的 two-step 工作流。

---

## Expected Behaviour

1. 用户点击 `🆕 New Code (with Review)` 按钮
2. Bot 回复 force-reply 提示用户输入指令
3. 用户输入指令（例如 "Add a login page"）
4. Bot 将用户指令作为第一条消息 enqueue（fresh session）
5. Bot 再将 review prompt 作为第二条消息 enqueue（fresh session）
6. Daemon 先执行用户指令（实现功能），然后执行 review 指令
7. Review 指令内容:
   - 对 previous commit + uncommitted changes 做深度 Code Review
   - 确保符合 SOLID 等工程原则
   - 确保实现了用户要求
   - **修复所有发现的问题**
8. 两条指令的结果正常返回给用户

---

## Design Decisions

### Decision 1: How to pass the review prompt to the daemon

**Options considered**

| # | Option | Pros | Cons |
|---|--------|------|------|
| A | **Bot-side dual queue (chosen)** | User's instruction runs first, then review runs independently; AI implements then reviews+f/puples — a clear two-step workflow; zero daemon changes | Two queued messages instead of one |
| B | Bot-side prompt composition (original v0.8.0) | Single enqueue; minimal code change | Combined prompt forces AI to do review and implementation in one pass, which can dilute focus |
| C | New `kind: "review"` field on messages table | Explicit semantics; daemon could handle review differently | Schema change; daemon change; over-engineering |
| D | Daemon-side prompt injection | Prompt logic lives with execution context | Tight coupling; requires daemon code change for a bot-level feature |

**Chosen: A (v0.9.0).** Instead of composing a single combined prompt, the bot now enqueues two separate fresh-run instructions: first the user's instruction, then a review instruction ending with "Fix all issues you found." This gives the AI a clear two-phase workplan — implement first, then review and fix. The change remains entirely in the bot package.

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
| A | Third button in the first row: `Code \| New Code \| New Code+Review` (v0.8.0) | All code-related actions together | First row has 3 buttons (slightly wider) |
| B | **Second row, on its own line (v0.9.0, chosen)** | Clear visual separation from Code / New Code; more tappable target | Needs an extra row in the menu |
| C | Sub-menu under "New Code" | Keeps main menu compact | Extra tap; less discoverable |

**Chosen: B (v0.9.0).** The "🔬 New Code + Review" button now sits alone on the second row of the inline keyboard, visually distinguishing it as a separate workflow from "💻 Code" and "🆕 New Code" on row 1.

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

Add button to `mainMenu()` — first row is Code + New Code, second row is Review alone:

```typescript
.text("💻 Code", CB.code)
.text("🆕 New Code", CB.newCode)
.row()
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
      "Enter the instruction for your daemon. This will queue your instruction " +
      "first, then automatically queue a deep code review on the previous commit " +
      "and uncommitted changes.\n\n" +
      "Reply with the instruction, or send `/cancel` to abort.",
    forceReply: true,
    inputPlaceholder: "Describe the code change",
    parseMode: "Markdown"
  };
}
```

### 4. Modify `handleInstructionSubmission` (`packages/bot/src/bot/handlers.ts`)

When `state.review === true`, enqueue two separate fresh-run instructions instead of composing one:

```typescript
// Review mode: queue user's instruction first, then a separate review instruction
if (state.review) {
  const session = await deps.sessions.getActiveByChatId(chatId);
  if (!session) { /* error */ }

  const ok = await deps.sessions.tryConsumeRate(session.id);
  if (!ok) throw ApiError.rateLimited();

  const pending = await deps.messages.count(session.id);
  if (pending >= MAX_QUEUE_DEPTH) { /* error */ }

  const profile = await deps.profiles.getById(session.profileId);
  const appliedEffort = profile?.tool === "OPENAI" ? codexReasoningEffort : undefined;

  // 1. Queue user instruction as a fresh run
  await deps.messages.enqueue({
    sessionId: session.id,
    content: instruction,
    resumeLastSession: false,
    codexReasoningEffort: appliedEffort
  });

  // 2. Compose and queue review instruction (ends with "Fix all issues you found")
  const reviewInstruction =
    `Deep Dive Code Review on the previous commit and uncommitted changes to make sure ` +
    `it complies with the software engineering principles such as SOLID, and it can achieve ` +
    `what user asked: ${instruction}. Fix all issues you found.`;

  if (reviewInstruction.length > MAX_INSTRUCTION_BYTES) { /* error */ }

  await deps.messages.enqueue({
    sessionId: session.id,
    content: reviewInstruction,
    resumeLastSession: false,
    codexReasoningEffort: appliedEffort
  });

  deps.flows.clear(chatId, telegramUser);
  return {
    text: `📥 Queued for daemon${suffix} (fresh).\n🔬 Review also queued.`,
    parseMode: "Markdown"
  };
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
| `packages/bot/src/bot/menus.ts` | Add `CB.newCodeReview` callback constant + button on row 2 |
| `packages/bot/src/bot/handlers.ts` | Add `handleNewCodeReviewRequest()`; modify `handleInstructionSubmission()` for dual-queue review (user instruction first, then review instruction ending with "Fix all issues you found") |
| `packages/bot/src/bot/bot.ts` | Wire `CB.newCodeReview` callback; update `recoverInstructionMode()` |
| `changes.md` | v0.9.0 changelog entry |
| `design-new-code-with-review.md` | This document — updated for dual-queue design |

---

## Post-Change Automation

Per AGENTS.md, after implementation:

1. **Update version** — Bump patch version in all `package.json` files (minor if considered a new feature)
2. **Update `changes.md`** — Add entry for new menu item
3. **Update `design.md`** — Add section about New Code (with Review) feature
4. **Update `README.md`** — Document the new menu item
5. **Commit and push**
6. **Restart** — `npm run local`
