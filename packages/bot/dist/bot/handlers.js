/**
 * Pure handlers for the Telegram bot. Each receives `deps` + the relevant
 * pieces of the incoming update and returns the reply(s) the bot should send.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { API_KEY_PREFIX, APP_VERSION, ApiError, MAX_INSTRUCTION_BYTES, MAX_QUEUE_DEPTH } from "@chatcoder/shared";
import { hashApiKey, validateUserSuppliedKey } from "../db/crypto.js";
import { backToMenu, folderPickerMenu, mainMenu, profilePickerMenu, toolIcon, workDirPickerMenu } from "./menus.js";
const WELCOME = "👋 *Chatcoder*\n\n" +
    "I relay instructions to a `chatcoder coder` service running on your own machine.\n\n" +
    "• Tap *New Session* to link this chat to a coder profile.\n" +
    "• Tap *Code* to run with session resume, or *New Code* for a fresh run.\n" +
    "• Tap *Latest Progress* to check the current in-progress output.\n";
function firstWords(text, limit) {
    return text.trim().split(/\s+/).filter(Boolean).slice(0, limit).join(" ");
}
function escapeMarkdown(text) {
    return text.replace(/([_*`[\]])/g, "\\$1");
}
/* =============== /start =============== */
export function handleStart() {
    return { text: WELCOME, keyboard: mainMenu(), parseMode: "Markdown" };
}
/* =============== Menu callback =============== */
export function handleMenu() {
    return { text: "Main menu", keyboard: mainMenu() };
}
/* =============== Version / Changelog =============== */
/** Resolve the monorepo root from this module's location on disk. */
function repoRoot() {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // From packages/bot/dist/bot/ → repo root
    return path.resolve(__dirname, "..", "..", "..", "..");
}
/** Show the app version and latest changelog entries. */
export function handleVersion() {
    const changesPath = path.join(repoRoot(), "changes.md");
    const pkgPath = path.join(repoRoot(), "package.json");
    let version = APP_VERSION;
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        version = pkg.version ?? version;
    }
    catch {
        // fall back to the compile-time constant
    }
    let changesText = "";
    try {
        if (existsSync(changesPath)) {
            const raw = readFileSync(changesPath, "utf-8");
            // Show only the most recent version section(s)
            const sections = raw.split(/(?=^## )/m);
            // Take up to 2 most recent version entries
            const recent = sections.slice(0, 2).join("").trim();
            changesText = recent || "*No changelog entries yet.*";
        }
        else {
            changesText = "*No changelog file found.*";
        }
    }
    catch {
        changesText = "*Could not read changelog.*";
    }
    return {
        text: `📦 *Chatcoder v${version}*\n\n${changesText}`,
        keyboard: mainMenu(),
        parseMode: "Markdown"
    };
}
async function getLatestSessionProfile(deps, chatId) {
    const session = await deps.sessions.getActiveByChatId(chatId);
    if (!session) {
        return {
            error: {
                text: "No active session. Tap *New Session* first.",
                keyboard: mainMenu(),
                parseMode: "Markdown"
            }
        };
    }
    const profile = await deps.profiles.getById(session.profileId);
    if (!profile) {
        return {
            error: {
                text: "❌ Session profile not found. Tap *New Session* to relink.",
                keyboard: mainMenu(),
                parseMode: "Markdown"
            }
        };
    }
    return { sessionId: session.id, profile };
}
/* =============== Status =============== */
export async function handleLatestProgress(deps, chatId) {
    const session = await deps.sessions.getActiveByChatId(chatId);
    if (!session) {
        return {
            text: "No active session. Tap *New Session* first.",
            keyboard: mainMenu(),
            parseMode: "Markdown"
        };
    }
    if (!session.latestMessage) {
        return {
            text: "No progress recorded yet.",
            keyboard: mainMenu()
        };
    }
    return {
        text: session.latestMessage,
        keyboard: mainMenu()
    };
}
export async function handleStatus(deps, chatId) {
    const sessions = await deps.sessions.listActiveByChatId(chatId);
    if (sessions.length === 0) {
        return {
            text: "You have no active sessions. Tap *New Session* to create one.",
            keyboard: mainMenu(),
            parseMode: "Markdown"
        };
    }
    const now = (deps.now ?? Date.now)();
    const staleMs = deps.heartbeatStaleMs ?? 60_000;
    const lines = [];
    for (const s of sessions) {
        const [profile, apiKey, pending, processing] = await Promise.all([
            deps.profiles.getById(s.profileId),
            deps.apiKeys.getById(s.apiKeyId),
            deps.messages.count(s.id),
            deps.messages.getProcessing(s.id)
        ]);
        if (!profile || !apiKey)
            continue;
        const hbMs = apiKey.lastHeartbeat;
        const alive = hbMs && now - hbMs < staleMs ? "🟢 online" : "🔴 offline";
        const hbText = hbMs
            ? `${Math.round((now - hbMs) / 1000)}s ago`
            : "never";
        const processingText = processing
            ? `\n  processing: _${escapeMarkdown(firstWords(processing.content, 20))}_`
            : "";
        lines.push(`${toolIcon(profile.tool)} *${profile.name}* \`${apiKey.apiKeyPrefix}…\`\n` +
            `  ${alive} (heartbeat ${hbText}) · pending *${pending}*/${MAX_QUEUE_DEPTH}` +
            processingText);
    }
    const text = `*Active sessions for this chat*\n\n` +
        lines.join("\n\n") +
        `\n\nUse *Code* (resume) or *New Code* (fresh) from the menu.`;
    return { text, keyboard: mainMenu(), parseMode: "Markdown" };
}
/* =============== New Session flow =============== */
export function handleNewSessionRequest(deps, chatId, telegramUser) {
    deps.flows.set(chatId, telegramUser, { kind: "awaiting_api_key" });
    return {
        text: "🔗 *Link a coder session*\n\n" +
            "Paste the API key from your `chatcoder coder --setup` flow (starts with `cc_`).\n" +
            "Reply with the API key.\n\n" +
            "Send `/cancel` to abort.",
        forceReply: true,
        inputPlaceholder: "Paste coder API key",
        parseMode: "Markdown"
    };
}
export function handleNewSessionCancel(deps, chatId, telegramUser) {
    deps.flows.clear(chatId, telegramUser);
    return { text: "Cancelled.", keyboard: mainMenu() };
}
/**
 * Called when the user sends a text message while in the `awaiting_api_key`
 * state. Looks up the daemon by api_key hash, validates it has profiles,
 * and transitions to `awaiting_profile` with a picker.
 *
 * Returns null if the user isn't in this flow (so the plain-text fallback
 * can take over).
 */
export async function handleApiKeySubmission(deps, chatId, telegramUser, text) {
    const state = deps.flows.get(chatId, telegramUser);
    const raw = normalizeApiKeyInput(text);
    if (state.kind !== "awaiting_api_key") {
        // Recover gracefully if the bot restarted mid-flow or the user pasted
        // the daemon key directly without tapping "New Session" first.
        if (!looksLikeDaemonApiKey(raw))
            return null;
        deps.flows.set(chatId, telegramUser, { kind: "awaiting_api_key" });
    }
    try {
        validateUserSuppliedKey(raw);
    }
    catch (e) {
        return {
            text: `❌ ${e.message}\n\nPaste a valid key in the reply box, or send \`/cancel\`.`,
            parseMode: "Markdown"
        };
    }
    const apiKey = await deps.apiKeys.getByHash(hashApiKey(raw));
    if (!apiKey) {
        return {
            text: "❌ I don't know that API key.\n" +
                "Make sure `chatcoder coder --setup` has run and connected at least once.\n\n" +
                "Try again in the reply box, or send `/cancel`.",
            parseMode: "Markdown"
        };
    }
    if (apiKey.status === "revoked") {
        return {
            text: "❌ That API key has been revoked. Generate a new one in the daemon.\n\n" +
                "Paste another key in the reply box, or send `/cancel`.",
            parseMode: "Markdown"
        };
    }
    const profiles = await deps.profiles.listByApiKey(apiKey.id);
    if (profiles.length === 0) {
        return {
            text: "⚠️ This coder service hasn't registered any profiles yet. " +
                "Run `chatcoder coder --setup` and add at least one profile.\n\n" +
                "Paste another key in the reply box, or send `/cancel`.",
            parseMode: "Markdown"
        };
    }
    deps.flows.set(chatId, telegramUser, {
        kind: "awaiting_profile",
        apiKeyId: apiKey.id
    });
    return {
        text: `✅ Daemon \`${apiKey.apiKeyPrefix}…\` found. ` +
            `Pick a profile for this session:`,
        keyboard: profilePickerMenu(profiles),
        parseMode: "Markdown"
    };
}
function normalizeApiKeyInput(text) {
    const trimmed = text.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === "`" || first === "'" || first === "\"") && last === first) {
            return trimmed.slice(1, -1).trim();
        }
    }
    // Users sometimes paste the key as "/cc_xxx", which Telegram treats as a
    // command-shaped string; treat it as the same key.
    if (trimmed.startsWith(`/${API_KEY_PREFIX}`))
        return trimmed.slice(1);
    return trimmed;
}
function looksLikeDaemonApiKey(raw) {
    return raw.startsWith(API_KEY_PREFIX);
}
export async function handleProfilePicked(deps, chatId, telegramUser, profileId) {
    const state = deps.flows.get(chatId, telegramUser);
    if (state.kind !== "awaiting_profile" && state.kind !== "awaiting_profile_menu") {
        return {
            text: "This flow expired. Tap *New Session* to start over.",
            keyboard: mainMenu(),
            parseMode: "Markdown"
        };
    }
    const profile = await deps.profiles.getById(profileId);
    if (!profile || profile.apiKeyId !== state.apiKeyId) {
        return {
            text: "❌ Unknown profile. Tap *New Session* to start over.",
            keyboard: mainMenu()
        };
    }
    // Coming from the standalone Profile menu — preserve workDir, just update profile
    if (state.kind === "awaiting_profile_menu") {
        const existing = await deps.sessions.getActiveByChatId(chatId);
        if (existing) {
            await deps.sessions.setProfile(existing.id, profileId);
            deps.flows.clear(chatId, telegramUser);
            return {
                text: `👤 *Profile switched.*\n` +
                    `${toolIcon(profile.tool)} \`${profile.name}\`\n` +
                    `session id: \`${existing.id.slice(0, 8)}\`\n\n` +
                    `Use *Code* or *New Code* to dispatch.`,
                keyboard: backToMenu(),
                parseMode: "Markdown"
            };
        }
        // No existing session — create one fresh
        const session = await deps.sessions.create({
            chatId,
            apiKeyId: state.apiKeyId,
            profileId
        });
        deps.flows.clear(chatId, telegramUser);
        return {
            text: `👤 *Active profile set.*\n` +
                `${toolIcon(profile.tool)} \`${profile.name}\`\n` +
                `session id: \`${session.id.slice(0, 8)}\`\n\n` +
                `Use *Code* or *New Code* to dispatch.`,
            keyboard: backToMenu(),
            parseMode: "Markdown"
        };
    }
    // Coming from New Session flow — check workDirs as before
    const apiKey = await deps.apiKeys.getById(state.apiKeyId);
    const workDirs = apiKey?.workDirs ?? [];
    if (workDirs.length > 0) {
        deps.flows.set(chatId, telegramUser, {
            kind: "awaiting_workdir",
            apiKeyId: state.apiKeyId,
            profileId
        });
        return {
            text: `✅ Profile \`${profile.name}\` selected.\n\n` +
                `This daemon has ${workDirs.length} working director${workDirs.length === 1 ? "y" : "ies"} configured. ` +
                "Pick one for this session, or skip to use the daemon's default directory.",
            keyboard: workDirPickerMenu(workDirs),
            parseMode: "Markdown"
        };
    }
    // No work dirs — create session immediately
    const session = await deps.sessions.create({
        chatId,
        apiKeyId: state.apiKeyId,
        profileId
    });
    deps.flows.clear(chatId, telegramUser);
    return {
        text: `✅ *Session linked.*\n` +
            `${toolIcon(profile.tool)} profile: \`${profile.name}\`\n` +
            `session id: \`${session.id.slice(0, 8)}\`\n\n` +
            `Use *Code* (resume) or *New Code* (fresh) from the menu to dispatch.`,
        keyboard: backToMenu(),
        parseMode: "Markdown"
    };
}
export async function handleWorkDirPicked(deps, chatId, telegramUser, result) {
    const state = deps.flows.get(chatId, telegramUser);
    if (state.kind !== "awaiting_workdir") {
        return {
            text: "This flow expired. Tap *New Session* to start over.",
            keyboard: mainMenu(),
            parseMode: "Markdown"
        };
    }
    const profile = await deps.profiles.getById(state.profileId);
    if (!profile || profile.apiKeyId !== state.apiKeyId) {
        return {
            text: "❌ Session setup expired. Tap *New Session* to start over.",
            keyboard: mainMenu()
        };
    }
    let workDir;
    if ("skip" in result) {
        workDir = undefined;
    }
    else {
        const apiKey = await deps.apiKeys.getById(state.apiKeyId);
        const workDirs = apiKey?.workDirs ?? [];
        if (result.index < 0 || result.index >= workDirs.length) {
            return {
                text: "❌ Invalid directory selection. Try again or start over.",
                keyboard: mainMenu()
            };
        }
        workDir = workDirs[result.index];
    }
    const session = await deps.sessions.create({
        chatId,
        apiKeyId: state.apiKeyId,
        profileId: state.profileId,
        workDir
    });
    deps.flows.clear(chatId, telegramUser);
    const dirLine = workDir ? `\n📁 work dir: \`${workDir}\`` : "";
    return {
        text: `✅ *Session linked.*\n` +
            `${toolIcon(profile.tool)} profile: \`${profile.name}\`` +
            dirLine +
            `\nsession id: \`${session.id.slice(0, 8)}\`\n\n` +
            `Use *Code* (resume) or *New Code* (fresh) from the menu to dispatch.`,
        keyboard: backToMenu(),
        parseMode: "Markdown"
    };
}
/* =============== Standalone Profile & Folder menus =============== */
export async function handleProfileMenu(deps, chatId, telegramUser) {
    const session = await deps.sessions.getActiveByChatId(chatId);
    if (!session) {
        return {
            text: "No active session. Tap *New Session* first to link a daemon.",
            keyboard: mainMenu(),
            parseMode: "Markdown"
        };
    }
    const apiKey = await deps.apiKeys.getById(session.apiKeyId);
    if (!apiKey) {
        return { text: "❌ Daemon not found.", keyboard: mainMenu() };
    }
    const profiles = await deps.profiles.listByApiKey(apiKey.id);
    if (profiles.length === 0) {
        return { text: "⚠️ No profiles available for this daemon.", keyboard: mainMenu() };
    }
    const currentProfile = await deps.profiles.getById(session.profileId);
    deps.flows.set(chatId, telegramUser, { kind: "awaiting_profile_menu", apiKeyId: apiKey.id });
    const currentLine = currentProfile
        ? `\nCurrent: ${toolIcon(currentProfile.tool)} \`${currentProfile.name}\``
        : "";
    return {
        text: `👤 *Select profile*${currentLine}\n\nChoose a profile:`,
        keyboard: profilePickerMenu(profiles),
        parseMode: "Markdown"
    };
}
export async function handleFolderMenu(deps, chatId, telegramUser) {
    const session = await deps.sessions.getActiveByChatId(chatId);
    if (!session) {
        return {
            text: "No active session. Tap *New Session* first.",
            keyboard: mainMenu(),
            parseMode: "Markdown"
        };
    }
    const apiKey = await deps.apiKeys.getById(session.apiKeyId);
    const workDirs = apiKey?.workDirs ?? [];
    if (workDirs.length === 0) {
        return {
            text: "This daemon has no working directories configured.\n\n" +
                "Add them via the daemon's menu (press W on the `chatcoder coder` screen).",
            keyboard: mainMenu()
        };
    }
    const currentDir = session.workDir;
    const currentLine = currentDir
        ? `Current: \`${currentDir}\``
        : "Current: daemon's default directory";
    return {
        text: `📁 *Select working directory*\n\n${currentLine}\n\nChoose a directory:`,
        keyboard: folderPickerMenu(workDirs),
        parseMode: "Markdown"
    };
}
export async function handleFolderPicked(deps, chatId, _telegramUser, result) {
    const session = await deps.sessions.getActiveByChatId(chatId);
    if (!session) {
        return {
            text: "No active session. Tap *New Session* first.",
            keyboard: mainMenu(),
            parseMode: "Markdown"
        };
    }
    let workDir;
    if ("useDefault" in result) {
        workDir = null;
    }
    else {
        const apiKey = await deps.apiKeys.getById(session.apiKeyId);
        const workDirs = apiKey?.workDirs ?? [];
        if (result.index < 0 || result.index >= workDirs.length) {
            return { text: "❌ Invalid selection.", keyboard: mainMenu() };
        }
        workDir = workDirs[result.index];
    }
    await deps.sessions.setWorkDir(session.id, workDir);
    const dirLine = workDir ? `📁 \`${workDir}\`` : "📁 daemon's default directory";
    return {
        text: `✅ Work directory set to ${dirLine}.`,
        keyboard: mainMenu(),
        parseMode: "Markdown"
    };
}
/* =============== Stop =============== */
export async function handleStop(deps, chatId) {
    const session = await deps.sessions.getActiveByChatId(chatId);
    if (!session) {
        return {
            text: "No active session. Tap *New Session* first.",
            keyboard: mainMenu(),
            parseMode: "Markdown"
        };
    }
    const profile = await deps.profiles.getById(session.profileId);
    await deps.messages.enqueue({
        sessionId: session.id,
        content: "stop",
        kind: "stop"
    });
    const suffix = profile ? ` → \`${profile.name}\`` : "";
    return {
        text: `⏹ Stop requested for daemon${suffix}.`,
        parseMode: "Markdown"
    };
}
/* =============== Instruction flows =============== */
export function handleCodeRequest(deps, chatId, telegramUser) {
    deps.flows.set(chatId, telegramUser, {
        kind: "awaiting_instruction",
        resumeLastSession: true
    });
    return {
        text: "💻 *Code (resume)*\n\n" +
            "Enter the instruction for your daemon. This will resume the last CLI session.\n\n" +
            "Reply with the instruction, or send `/cancel` to abort.",
        forceReply: true,
        inputPlaceholder: "Describe the code change",
        parseMode: "Markdown"
    };
}
export function handleNewCodeRequest(deps, chatId, telegramUser) {
    deps.flows.set(chatId, telegramUser, {
        kind: "awaiting_instruction",
        resumeLastSession: false
    });
    return {
        text: "🆕 *New Code (fresh)*\n\n" +
            "Enter the instruction for your daemon. This will start a fresh CLI run.\n\n" +
            "Reply with the instruction, or send `/cancel` to abort.",
        forceReply: true,
        inputPlaceholder: "Describe the code change",
        parseMode: "Markdown"
    };
}
export async function handleInstructionSubmission(deps, chatId, telegramUser, text) {
    const state = deps.flows.get(chatId, telegramUser);
    if (state.kind !== "awaiting_instruction")
        return null;
    const instruction = text.trim();
    if (instruction.length === 0) {
        return {
            text: "❌ Instruction cannot be empty. Enter a message or send `/cancel`.",
            parseMode: "Markdown"
        };
    }
    if (instruction.length > MAX_INSTRUCTION_BYTES) {
        return {
            text: `❌ Instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes.\n` +
                "Send a shorter instruction or `/cancel`.",
            parseMode: "Markdown"
        };
    }
    const codexReasoningEffort = deps.flows.getCodexReasoningEffort(chatId, telegramUser);
    const reply = await handleCode(deps, chatId, instruction, state.resumeLastSession, codexReasoningEffort);
    deps.flows.clear(chatId, telegramUser);
    return reply;
}
export async function handleCode(deps, chatId, instruction, resumeLastSession = true, codexReasoningEffort) {
    if (instruction.length === 0) {
        return { text: "❌ Instruction cannot be empty." };
    }
    if (instruction.length > MAX_INSTRUCTION_BYTES) {
        return {
            text: `❌ Instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes. Shorten and retry.`
        };
    }
    const session = await deps.sessions.getActiveByChatId(chatId);
    if (!session) {
        return {
            text: "No active session. Tap *New Session* first.",
            keyboard: mainMenu(),
            parseMode: "Markdown"
        };
    }
    const ok = await deps.sessions.tryConsumeRate(session.id);
    if (!ok) {
        throw ApiError.rateLimited();
    }
    const pending = await deps.messages.count(session.id);
    if (pending >= MAX_QUEUE_DEPTH) {
        return {
            text: `❌ Queue full (${MAX_QUEUE_DEPTH} pending). Wait for your daemon to drain it.`
        };
    }
    const profile = await deps.profiles.getById(session.profileId);
    const appliedEffort = profile?.tool === "OPENAI" ? codexReasoningEffort : undefined;
    await deps.messages.enqueue({
        sessionId: session.id,
        content: instruction,
        resumeLastSession,
        codexReasoningEffort: appliedEffort
    });
    await deps.sessions.setLatestMessage(session.id, null);
    const suffix = profile ? ` → \`${profile.name}\`` : "";
    const mode = resumeLastSession ? "resume" : "fresh";
    const effortSuffix = appliedEffort ? ` · effort \`${appliedEffort}\`` : "";
    return {
        text: `📥 Queued for daemon${suffix} (${mode}${effortSuffix}).`,
        parseMode: "Markdown"
    };
}
/* =============== Plain text fallback =============== */
export function handlePlainText() {
    return {
        text: "Use the menu buttons to send instructions:\n" +
            "• *Code* = resume last session\n" +
            "• *New Code* = fresh run",
        keyboard: mainMenu(),
        parseMode: "Markdown"
    };
}
//# sourceMappingURL=handlers.js.map