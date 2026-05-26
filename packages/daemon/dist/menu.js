import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadRawConfig, writeRawConfig } from "./config.js";
import { launchProfile } from "./launcher.js";
import { makeCoderUi, clearScreen, printBanner, printSection, printLine, footerItem, printInfo, printSuccess, printWarning, readKey, pause, toolLabel, LANDING_PAGE_SIZE, selectedProfileIndex, promptProfileEditor, promptApiUrl, promptApiKey, promptMaxConcurrency } from "./setup.js";
/* -------------------------------------------------------------------------- */
/*  Root dir helper for spawning daemon                                       */
/* -------------------------------------------------------------------------- */
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
/* -------------------------------------------------------------------------- */
/*  Config helpers                                                             */
/* -------------------------------------------------------------------------- */
function defaultConfig() {
    return {
        apiUrl: "http://localhost:8080",
        apiKey: "",
        maxConcurrency: 4,
        pollIntervalMs: 2000,
        pollJitterMs: 250,
        heartbeatIntervalMs: 15000,
        idleShutdownMs: 3600000,
        profiles: [],
        workDirs: []
    };
}
function loadOrCreateCfg() {
    const raw = loadRawConfig();
    if (!raw)
        return defaultConfig();
    return {
        apiUrl: typeof raw.apiUrl === "string" ? raw.apiUrl : "http://localhost:8080",
        apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
        maxConcurrency: typeof raw.maxConcurrency === "number" ? raw.maxConcurrency : 4,
        profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
        pollIntervalMs: typeof raw.pollIntervalMs === "number" ? raw.pollIntervalMs : 2000,
        pollJitterMs: typeof raw.pollJitterMs === "number" ? raw.pollJitterMs : 250,
        heartbeatIntervalMs: typeof raw.heartbeatIntervalMs === "number" ? raw.heartbeatIntervalMs : 15000,
        idleShutdownMs: typeof raw.idleShutdownMs === "number" ? raw.idleShutdownMs : 3600000,
        workDirs: Array.isArray(raw.workDirs) ? raw.workDirs : []
    };
}
function saveCfg(cfg) {
    writeRawConfig(cfg);
}
/* -------------------------------------------------------------------------- */
/*  Profile management helpers                                                */
/* -------------------------------------------------------------------------- */
function showProfiles(ui, page, selectedSlot, profiles) {
    const total = profiles.length;
    printBanner(ui);
    out(ui, `${ui.BOLD}Select a profile to activate${ui.RESET}`);
    out(ui, `${ui.DIM}Use arrow keys to select, Enter to activate, shortcuts for actions.${ui.RESET}`);
    out(ui, "");
    if (total === 0) {
        printInfo(ui, "No profiles found. Press A to add your first profile.");
        out(ui, "");
    }
    const start = page * LANDING_PAGE_SIZE;
    const end = Math.min(total, start + LANDING_PAGE_SIZE);
    let slot = 0;
    for (let idx = start; idx < end; idx++) {
        const p = profiles[idx];
        const isSelected = slot === selectedSlot;
        const prefix = isSelected ? "›" : " ";
        const suffix = isSelected ? `  ${ui.CARD_ACCENT}selected${ui.RESET}` : "";
        out(ui, `${ui.CARD_ACCENT}${prefix} [${slot + 1}]${ui.RESET} ${ui.BOLD}${p.name}${ui.RESET}` +
            `  ${ui.DIM}${toolLabel(p.tool)}${ui.RESET}${suffix}`);
        slot++;
    }
    const pageCount = Math.max(1, Math.ceil(total / LANDING_PAGE_SIZE));
    out(ui, `\n${ui.DIM}Page ${page + 1} of ${pageCount}${ui.RESET}`);
}
function showWorkDirs(ui, workDirs) {
    const count = workDirs.length;
    if (count === 0) {
        out(ui, `\n${ui.DIM}Work Dirs:${ui.RESET} none`);
    }
    else {
        out(ui, `\n${ui.DIM}Work Dirs (${count}):${ui.RESET}`);
        for (const d of workDirs) {
            out(ui, `  ${ui.CARD_BORDER}•${ui.RESET} ${d}`);
        }
    }
    out(ui, "");
}
function showFooter(ui) {
    out(ui, "");
    printLine(ui);
    process.stdout.write(footerItem(ui, "Enter", "Activate"));
    process.stdout.write(footerItem(ui, "A", "Add"));
    process.stdout.write(footerItem(ui, "U", "Update"));
    process.stdout.write(footerItem(ui, "D", "Delete"));
    process.stdout.write(footerItem(ui, "R", "Run Daemon"));
    process.stdout.write(footerItem(ui, "W", "Work Dirs"));
    process.stdout.write(footerItem(ui, "S", "Settings"));
    process.stdout.write(footerItem(ui, "Q", "Quit"));
    out(ui, "\n");
}
function out(ui, lineText = "") {
    process.stdout.write(lineText + "\n");
}
function printProfileSummary(ui, p) {
    out(ui, `${ui.DIM}Tool:${ui.RESET} ${toolLabel(p.tool)}`);
    out(ui, `${ui.DIM}Metadata:${ui.RESET} ${p.metadata ?? "<none>"}`);
}
/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */
async function addProfileAction(ui, profiles) {
    const taken = new Set(profiles.map((p) => p.name));
    const profile = await promptProfileEditor(ui, undefined, taken);
    if (!profile)
        return;
    profiles.push(profile);
    printSuccess(ui, `Profile "${profile.name}" created`);
    await pause(ui);
}
async function updateProfileAction(ui, profiles, index) {
    const existing = profiles[index];
    if (!existing) {
        printWarning(ui, "No profile selected");
        await pause(ui);
        return;
    }
    const taken = new Set(profiles.map((p) => p.name).filter((name) => name !== existing.name));
    const edited = await promptProfileEditor(ui, existing, taken);
    if (!edited)
        return;
    profiles[index] = edited;
    printSuccess(ui, `Profile "${edited.name}" updated`);
    await pause(ui);
}
async function confirmDelete(ui, promptText) {
    const ans = await askLineSimple(`${ui.CARD_ACCENT}›${ui.RESET} ${promptText} (y/N): `);
    if (ans === null)
        return false;
    return /^y(es)?$/i.test(ans.trim());
}
async function deleteProfileAction(ui, profiles, index) {
    const existing = profiles[index];
    if (!existing) {
        printWarning(ui, "No profile selected");
        await pause(ui);
        return;
    }
    clearScreen();
    printBanner(ui);
    printSection(ui, "Delete Profile");
    out(ui, `${ui.BOLD}Selected profile${ui.RESET}`);
    printProfileSummary(ui, existing);
    out(ui, "");
    if (!(await confirmDelete(ui, `Delete "${existing.name}"`))) {
        printInfo(ui, "Delete cancelled");
        await pause(ui);
        return;
    }
    if (!(await confirmDelete(ui, `Confirm permanent delete for "${existing.name}"`))) {
        printInfo(ui, "Delete cancelled");
        await pause(ui);
        return;
    }
    profiles.splice(index, 1);
    // Clear last_selected marker if stored
    printSuccess(ui, `Profile "${existing.name}" deleted`);
    await pause(ui);
}
async function handleActivate(ui, profile) {
    clearScreen();
    printBanner(ui);
    printSection(ui, "Launching Tool");
    out(ui, `${ui.BOLD}${profile.name}${ui.RESET} — ${toolLabel(profile.tool)}`);
    printProfileSummary(ui, profile);
    out(ui, "");
    out(ui, `${ui.DIM}The tool will start. When you exit, you'll return to the menu.${ui.RESET}`);
    await pause(ui);
    // Suppress SIGINT so Ctrl+C in the tool doesn't kill the menu
    const onSigint = () => { };
    process.on("SIGINT", onSigint);
    try {
        const code = await launchProfile(profile);
        clearScreen();
        if (code === 0) {
            printInfo(ui, `Tool exited (code ${code}).`);
        }
        else {
            printWarning(ui, `Tool exited with code ${code}.`);
        }
    }
    catch (err) {
        clearScreen();
        const msg = err instanceof Error ? err.message : String(err);
        printWarning(ui, `Failed to launch tool: ${msg}`);
    }
    finally {
        process.off("SIGINT", onSigint);
    }
    await pause(ui);
}
async function handleRunDaemon(ui) {
    const entryPath = resolve(PROJECT_ROOT, "packages", "daemon", "dist", "main.js");
    clearScreen();
    printBanner(ui);
    printSection(ui, "Daemon");
    out(ui, `${ui.DIM}Starting daemon. Press Ctrl+C to stop and return to the menu.${ui.RESET}`);
    out(ui, "");
    await new Promise((resolvePromise) => {
        const child = spawn(process.execPath, [entryPath, "run"], {
            cwd: PROJECT_ROOT,
            stdio: "inherit",
            env: process.env,
            // Share process group so child receives terminal signals
        });
        // Suppress SIGINT in the parent — the child's handler will process it
        // and exit, then we resume the menu.
        const onSigint = () => {
            // no-op: child handles it
        };
        process.on("SIGINT", onSigint);
        const done = () => {
            process.off("SIGINT", onSigint);
            resolvePromise();
        };
        child.on("close", done);
        child.on("error", done);
    });
}
async function handleSetWorkDirs(ui, cfg) {
    const dirs = cfg.workDirs ?? [];
    for (;;) {
        clearScreen();
        printBanner(ui);
        printSection(ui, "Working Directories (daemon mode)");
        if (dirs.length === 0) {
            printInfo(ui, "No working directories configured.");
            out(ui, "");
        }
        else {
            for (let i = 0; i < dirs.length; i++) {
                out(ui, `  ${ui.CARD_ACCENT}[${i + 1}]${ui.RESET} ${dirs[i]}`);
            }
            out(ui, "");
        }
        printLine(ui);
        process.stdout.write(footerItem(ui, "A", "Add"));
        process.stdout.write(footerItem(ui, "D", "Delete"));
        process.stdout.write(footerItem(ui, "Q", "Back"));
        out(ui, "\n");
        const key = await readKey();
        if (key === null || key === "q" || key === "Q" || key === "\x1b" || key === "") {
            cfg.workDirs = dirs;
            saveCfg(cfg);
            return;
        }
        if (key === "a" || key === "A") {
            const input = await askLineSimple(`${ui.CARD_ACCENT}›${ui.RESET} Add working directory path: `);
            if (input === null)
                return;
            const trimmed = input.trim();
            if (trimmed.length > 0) {
                dirs.push(trimmed);
                cfg.workDirs = dirs;
                saveCfg(cfg);
            }
            continue;
        }
        if (key === "d" || key === "D") {
            if (dirs.length === 0) {
                printWarning(ui, "No directories to delete.");
                await pause(ui);
                continue;
            }
            const input = await askLineSimple(`${ui.CARD_ACCENT}›${ui.RESET} Number to delete: `);
            if (input === null)
                return;
            const idx = parseInt(input.trim(), 10) - 1;
            if (idx >= 0 && idx < dirs.length) {
                dirs.splice(idx, 1);
                cfg.workDirs = dirs;
                saveCfg(cfg);
                printSuccess(ui, "Deleted.");
                await pause(ui);
            }
            else {
                printWarning(ui, "Invalid number.");
                await pause(ui);
            }
            continue;
        }
    }
}
async function handleSettings(ui, cfg) {
    const apiUrl = await promptApiUrl(ui, cfg.apiUrl ?? "http://localhost:8080");
    if (apiUrl === null)
        return;
    const apiKey = await promptApiKey(ui, cfg.apiKey);
    if (apiKey === null)
        return;
    const maxConcurrency = await promptMaxConcurrency(ui, cfg.maxConcurrency ?? 4);
    if (maxConcurrency === null)
        return;
    cfg.apiUrl = apiUrl;
    cfg.apiKey = apiKey;
    cfg.maxConcurrency = maxConcurrency;
    saveCfg(cfg);
    clearScreen();
    printBanner(ui);
    printSuccess(ui, "Daemon settings saved.");
    await pause(ui);
}
async function askLineSimple(promptText) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });
    try {
        return await rl.question(promptText);
    }
    catch {
        return null;
    }
    finally {
        rl.close();
    }
}
/* -------------------------------------------------------------------------- */
/*  Main menu loop                                                            */
/* -------------------------------------------------------------------------- */
export async function showMainMenu() {
    const ui = makeCoderUi();
    let cfg;
    let profiles;
    // Load or initialise
    cfg = loadOrCreateCfg();
    profiles = cfg.profiles ?? [];
    let page = 0;
    let selectedSlot = 0;
    for (;;) {
        const total = profiles.length;
        // Clamp navigation bounds
        if (total === 0) {
            page = 0;
            selectedSlot = 0;
        }
        else {
            const pageCount = Math.ceil(total / LANDING_PAGE_SIZE);
            if (page >= pageCount)
                page = pageCount - 1;
            const lastSlot = Math.min(LANDING_PAGE_SIZE - 1, total - page * LANDING_PAGE_SIZE - 1);
            if (selectedSlot > lastSlot)
                selectedSlot = lastSlot;
        }
        clearScreen();
        showProfiles(ui, page, selectedSlot, profiles);
        showWorkDirs(ui, cfg.workDirs ?? []);
        showFooter(ui);
        const key = await readKey();
        if (key === null) {
            printInfo(ui, "Input closed. Exiting.");
            clearScreen();
            return;
        }
        if (key === "") {
            clearScreen();
            return;
        }
        const idx = selectedProfileIndex(page, selectedSlot, total);
        switch (key) {
            // Arrow Up
            case "\x1b[A":
                if (total > 0 && selectedSlot > 0)
                    selectedSlot--;
                break;
            // Arrow Down
            case "\x1b[B":
                if (total > 0) {
                    const lastSlot = Math.min(LANDING_PAGE_SIZE - 1, total - page * LANDING_PAGE_SIZE - 1);
                    if (selectedSlot < lastSlot)
                        selectedSlot++;
                }
                break;
            // Arrow Left
            case "\x1b[D":
                if (total > 0 && page > 0) {
                    page--;
                    selectedSlot = 0;
                }
                break;
            // Arrow Right
            case "\x1b[C":
                if (total > 0 && (page + 1) * LANDING_PAGE_SIZE < total) {
                    page++;
                    selectedSlot = 0;
                }
                break;
            // Enter — Activate
            case "":
                if (idx !== null && profiles[idx]) {
                    await handleActivate(ui, profiles[idx]);
                }
                else {
                    printWarning(ui, "No profile selected.");
                    await pause(ui);
                }
                break;
            // A — Add profile
            case "a":
            case "A":
                await addProfileAction(ui, profiles);
                cfg.profiles = profiles;
                saveCfg(cfg);
                break;
            // U — Update profile
            case "u":
            case "U":
                if (idx !== null && profiles[idx]) {
                    await updateProfileAction(ui, profiles, idx);
                    cfg.profiles = profiles;
                    saveCfg(cfg);
                }
                else {
                    printWarning(ui, "No profile selected.");
                    await pause(ui);
                }
                break;
            // D — Delete profile
            case "d":
            case "D":
                if (idx !== null && profiles[idx]) {
                    await deleteProfileAction(ui, profiles, idx);
                    cfg.profiles = profiles;
                    saveCfg(cfg);
                }
                else {
                    printWarning(ui, "No profile selected.");
                    await pause(ui);
                }
                break;
            // R — Run daemon
            case "r":
            case "R":
                await handleRunDaemon(ui);
                break;
            // W — Working directories
            case "w":
            case "W":
                await handleSetWorkDirs(ui, cfg);
                break;
            // S — Settings
            case "s":
            case "S":
                await handleSettings(ui, cfg);
                profiles = cfg.profiles ?? [];
                break;
            // Q — Quit
            case "q":
            case "Q":
            case "0":
                clearScreen();
                return;
            default:
                printWarning(ui, "Invalid selection.");
                await pause(ui);
                break;
        }
    }
}
//# sourceMappingURL=menu.js.map