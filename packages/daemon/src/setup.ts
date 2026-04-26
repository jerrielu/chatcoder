import { createInterface } from "node:readline/promises";
import prompts from "prompts";
import { MAX_PROFILES_PER_DAEMON } from "@chatcoder/shared";
import { DaemonConfig, writeConfig, defaultConfigPath } from "./config.js";
import { generateApiKey } from "./crypto.js";
import { ensureCodexHome } from "./codexHome.js";
import { Profile as ProfileSchema } from "./profile.js";
import type { Profile } from "./profile.js";

export interface SetupIO {
  prompt: typeof prompts;
  log: (msg: string) => void;
}

const defaultIO: SetupIO = {
  prompt: prompts,
  log: (m) => process.stdout.write(m + "\n")
};

const LINE = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
const LANDING_PAGE_SIZE = 6;

export const validators = {
  apiUrl: (v: string): true | string =>
    /^https?:\/\//.test(v) ? true : "Must be a http(s):// URL",
  apiKey: (v: string): true | string =>
    v.length >= 16 ? true : "Key must be ≥16 chars",
  profileName: (v: string): true | string =>
    /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(v)
      ? true
      : "Name must be slug-like (letters, digits, _, -, .)",
  nonEmpty: (v: string): true | string => (v && v.length > 0 ? true : "Required")
};

function toolLabel(tool: Profile["tool"]): string {
  switch (tool) {
    case "CLAUDE_CODE":
      return "Claude Code";
    case "OPENAI":
      return "OpenAI Codex / OpenAI API";
    case "CUSTOM":
      return "Custom Tool";
  }
}

function toolChoiceIndex(tool: Profile["tool"] | undefined): number {
  if (tool === "OPENAI") return 1;
  if (tool === "CUSTOM") return 2;
  return 0;
}

function messagePlacementChoiceIndex(
  placement: "appended" | "stdin" | "placeholder" | undefined
): number {
  if (placement === "stdin") return 1;
  if (placement === "placeholder") return 2;
  return 0;
}

function outputFormatChoiceIndex(format: "text" | "stream-json" | undefined): number {
  return format === "stream-json" ? 1 : 0;
}

function seedProfiles(existing?: Partial<DaemonConfig>): Profile[] {
  const out: Profile[] = [];
  for (const raw of existing?.profiles ?? []) {
    const parsed = ProfileSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function syncOpenAiProfileHomes(cfg: DaemonConfig): void {
  for (const profile of cfg.profiles) {
    if (profile.tool !== "OPENAI") continue;
    ensureCodexHome(profile.name, profile.codex);
  }
}

/* -------------------------------------------------------------------------- */
/* Coder-style full-screen UI                                                 */
/* -------------------------------------------------------------------------- */

interface CoderUi {
  RESET: string;
  BOLD: string;
  DIM: string;
  RED: string;
  GREEN: string;
  YELLOW: string;
  BLUE: string;
  CARD_BORDER: string;
  CARD_ACCENT: string;
}

interface PickerOption<T extends string> {
  label: string;
  value: T;
}

function canUseCoderStyle(io: SetupIO): boolean {
  return io === defaultIO && process.stdin.isTTY && process.stdout.isTTY;
}

function makeCoderUi(): CoderUi {
  const isColor = process.stdout.isTTY && process.env["TERM"] !== "dumb";
  if (!isColor) {
    return {
      RESET: "",
      BOLD: "",
      DIM: "",
      RED: "",
      GREEN: "",
      YELLOW: "",
      BLUE: "",
      CARD_BORDER: "",
      CARD_ACCENT: ""
    };
  }
  const ESC = "\x1b[";
  return {
    RESET: `${ESC}0m`,
    BOLD: `${ESC}1m`,
    DIM: `${ESC}2m`,
    RED: `${ESC}31m`,
    GREEN: `${ESC}32m`,
    YELLOW: `${ESC}33m`,
    BLUE: `${ESC}34m`,
    CARD_BORDER: `${ESC}38;5;240m`,
    CARD_ACCENT: `${ESC}38;5;45m`
  };
}

function out(line = ""): void {
  process.stdout.write(line + "\n");
}

function clearScreen(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1Bc");
}

function printLine(ui: CoderUi): void {
  out(`${ui.CARD_BORDER}${LINE}${ui.RESET}`);
}

function printBanner(ui: CoderUi): void {
  printLine(ui);
  out(`${ui.BOLD}${ui.CARD_ACCENT}  coder${ui.RESET}${ui.DIM}  profile manager${ui.RESET}`);
  printLine(ui);
}

function printSection(ui: CoderUi, title: string): void {
  out("");
  out(`${ui.BOLD}${title}${ui.RESET}`);
  printLine(ui);
}

function printPickerOption(ui: CoderUi, selected: boolean, label: string): void {
  const marker = selected ? "›" : " ";
  const accent = selected ? ui.CARD_ACCENT : ui.CARD_BORDER;
  out(`${accent}${marker}${ui.RESET} ${ui.BOLD}${label}${ui.RESET}`);
}

function footerItem(ui: CoderUi, key: string, label: string): string {
  return `${ui.CARD_ACCENT}[${key}]${ui.RESET} ${label}  `;
}

function printInfo(ui: CoderUi, message: string): void {
  out(`${ui.BLUE}info${ui.RESET} ${message}`);
}

function printSuccess(ui: CoderUi, message: string): void {
  out(`${ui.GREEN}success${ui.RESET} ${message}`);
}

function printWarning(ui: CoderUi, message: string): void {
  out(`${ui.YELLOW}warning${ui.RESET} ${message}`);
}

async function readKey(): Promise<string | null> {
  if (!process.stdin.isTTY) return null;

  return new Promise((resolve) => {
    const stdin = process.stdin;

    const onData = (chunk: Buffer): void => {
      cleanup();
      let key = chunk.toString("utf8");
      if (key === "\r" || key === "\n") key = "";
      resolve(key);
    };

    const cleanup = (): void => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {
        // noop
      }
      stdin.pause();
    };

    stdin.resume();
    try {
      stdin.setRawMode(true);
    } catch {
      // noop
    }
    stdin.on("data", onData);
  });
}

async function askLine(promptText: string, initial?: string): Promise<string | null> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });
  try {
    const pending = rl.question(promptText);
    if (initial !== undefined && initial.length > 0) {
      rl.write(initial);
    }
    return await pending;
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

async function ask(ui: CoderUi, promptText: string): Promise<string | null> {
  return askLine(`${ui.CARD_ACCENT}›${ui.RESET} ${promptText}`);
}

async function askWithDefault(
  ui: CoderUi,
  promptText: string,
  initial: string
): Promise<string | null> {
  const outValue = await askLine(`${ui.CARD_ACCENT}›${ui.RESET} ${promptText}`, initial);
  if (outValue === null) return null;
  return outValue.length === 0 ? initial : outValue;
}

async function pause(ui: CoderUi): Promise<void> {
  await askLine(`\n${ui.DIM}Press Enter to continue...${ui.RESET}`);
}

async function askValidated(
  ui: CoderUi,
  promptText: string,
  initial: string,
  validate: (v: string) => true | string
): Promise<string | null> {
  let nextInitial = initial;
  for (;;) {
    const v = await askWithDefault(ui, promptText, nextInitial);
    if (v === null) return null;
    const ok = validate(v);
    if (ok === true) return v;
    printWarning(ui, ok);
    nextInitial = v;
  }
  return null;
}

async function askYesNo(
  ui: CoderUi,
  promptText: string,
  initial: boolean
): Promise<boolean | null> {
  const defaultText = initial ? "y" : "n";
  for (;;) {
    const input = await askWithDefault(ui, `${promptText} (y/N): `, defaultText);
    if (input === null) return null;
    const v = input.trim().toLowerCase();
    if (v === "y" || v === "yes") return true;
    if (v === "n" || v === "no") return false;
    printWarning(ui, "Please enter y or n.");
  }
  return null;
}

async function pickWithArrows<T extends string>(
  ui: CoderUi,
  section: string,
  promptText: string,
  options: Array<PickerOption<T>>,
  initial = 0
): Promise<T | null> {
  let selected = Math.max(0, Math.min(initial, options.length - 1));
  for (;;) {
    clearScreen();
    printBanner(ui);
    printSection(ui, section);
    out(`${ui.DIM}${promptText}${ui.RESET}`);
    out("");

    for (let i = 0; i < options.length; i += 1) {
      const option = options[i]!;
      printPickerOption(ui, i === selected, option.label);
    }

    out("");
    printLine(ui);
    process.stdout.write(footerItem(ui, "↑/↓", "Select"));
    process.stdout.write(footerItem(ui, "Enter", "Confirm"));
    process.stdout.write(footerItem(ui, "Q", "Back"));
    process.stdout.write(footerItem(ui, "coder", "setup"));
    out("\n");

    const key = await readKey();
    if (key === null) return null;
    if (key === "\u0003") process.exit(130);
    if (key === "\x1b" || key === "q" || key === "Q") return null;
    if (key === "\x1b[A") {
      if (selected > 0) selected -= 1;
      continue;
    }
    if (key === "\x1b[B") {
      if (selected < options.length - 1) selected += 1;
      continue;
    }
    if (key === "") return options[selected]!.value;
  }
  return null;
}

function parseArgsRaw(raw: string): string[] {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

function parseEnvRaw(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const pair of raw.trim().split(/\s+/).filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return env;
}

function formatEnvRaw(env: Record<string, string>): string {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");
}

function selectedProfileIndex(page: number, selectedSlot: number, total: number): number | null {
  const idx = page * LANDING_PAGE_SIZE + selectedSlot;
  return idx < total ? idx : null;
}

function showSetupProfiles(
  ui: CoderUi,
  page: number,
  selectedSlot: number,
  profiles: Profile[]
): void {
  const total = profiles.length;
  printBanner(ui);
  out(`${ui.BOLD}Configure Daemon Profiles${ui.RESET}`);
  out(`${ui.DIM}Use arrow keys to select, Enter to continue, and shortcuts below for actions.${ui.RESET}`);
  out("");

  if (total === 0) {
    printInfo(ui, "No profiles found. Press A to add your first profile.");
    return;
  }

  const start = page * LANDING_PAGE_SIZE;
  const end = Math.min(total, start + LANDING_PAGE_SIZE);
  let slot = 0;

  for (let idx = start; idx < end; idx += 1) {
    const p = profiles[idx]!;
    const isSelected = slot === selectedSlot;
    const prefix = isSelected ? "›" : " ";
    const suffix = isSelected ? `  ${ui.CARD_ACCENT}selected${ui.RESET}` : "";
    out(
      `${ui.CARD_ACCENT}${prefix} [${slot + 1}]${ui.RESET} ${ui.BOLD}${p.name}${ui.RESET}` +
        `  ${ui.DIM}${toolLabel(p.tool)}${ui.RESET}${suffix}`
    );
    slot += 1;
  }

  const pageCount = Math.max(1, Math.ceil(total / LANDING_PAGE_SIZE));
  out(`\n${ui.DIM}Page ${page + 1} of ${pageCount}${ui.RESET}`);
}

function showSetupFooter(ui: CoderUi): void {
  out("");
  printLine(ui);
  process.stdout.write(footerItem(ui, "Enter", "Continue"));
  process.stdout.write(footerItem(ui, "A", "Add"));
  process.stdout.write(footerItem(ui, "U", "Update"));
  process.stdout.write(footerItem(ui, "D", "Delete"));
  process.stdout.write(footerItem(ui, "Q", "Abort"));
  process.stdout.write(footerItem(ui, "coder", "setup"));
  out("\n");
}

async function pickTool(ui: CoderUi, initialTool: Profile["tool"] | undefined): Promise<Profile["tool"] | null> {
  const options: Array<PickerOption<Profile["tool"] | "__BACK__">> = [
    { label: "Claude Code", value: "CLAUDE_CODE" },
    { label: "OpenAI Codex / OpenAI API", value: "OPENAI" },
    { label: "Custom Tool", value: "CUSTOM" },
    { label: "Back", value: "__BACK__" }
  ];
  const selected = await pickWithArrows(
    ui,
    "Select Tool",
    "Use arrow keys to choose a tool, then press Enter.",
    options,
    toolChoiceIndex(initialTool)
  );
  if (selected === null || selected === "__BACK__") return null;
  return selected;
}

type ClaudeCfg = Extract<Profile, { tool: "CLAUDE_CODE" }>["claudeCode"];
type OpenAiCfg = Extract<Profile, { tool: "OPENAI" }>["codex"];
type CustomCfg = Extract<Profile, { tool: "CUSTOM" }>["custom"];

async function promptClaude(ui: CoderUi, prev?: ClaudeCfg): Promise<ClaudeCfg | null> {
  const editAuth = await askYesNo(
    ui,
    "Edit authentication for this profile?",
    prev?.apiKey === undefined
  );
  if (editAuth === null) return null;

  let apiKey = prev?.apiKey;
  let baseUrl = prev?.baseUrl;
  if (editAuth) {
    const nextApiKey = await askValidated(
      ui,
      "ANTHROPIC_API_KEY: ",
      prev?.apiKey ?? "",
      validators.nonEmpty
    );
    if (nextApiKey === null) return null;
    apiKey = nextApiKey;
    const nextBaseUrl = await askWithDefault(
      ui,
      "ANTHROPIC_BASE_URL (blank = default): ",
      prev?.baseUrl ?? ""
    );
    if (nextBaseUrl === null) return null;
    if (nextBaseUrl.length > 0) {
      const ok = validators.apiUrl(nextBaseUrl);
      if (ok !== true) {
        printWarning(ui, ok);
        return promptClaude(ui, { ...prev, apiKey, baseUrl: nextBaseUrl } as ClaudeCfg);
      }
    }
    baseUrl = nextBaseUrl || undefined;
  }

  const model = await askWithDefault(ui, "Model (blank = Claude default): ", prev?.model ?? "");
  if (model === null) return null;

  const skipPermissions = await askYesNo(
    ui,
    "Pass --dangerously-skip-permissions?",
    prev?.skipPermissions ?? true
  );
  if (skipPermissions === null) return null;

  const outputFormat = await pickWithArrows<"text" | "stream-json" | "__BACK__">(
    ui,
    "Output Format",
    "Select output format.",
    [
      { label: "text (default)", value: "text" },
      { label: "stream-json", value: "stream-json" },
      { label: "Back", value: "__BACK__" }
    ],
    outputFormatChoiceIndex(prev?.outputFormat)
  );
  if (outputFormat === null || outputFormat === "__BACK__") return null;

  return {
    apiKey,
    baseUrl,
    model: model || undefined,
    skipPermissions,
    outputFormat,
    extraArgs: prev?.extraArgs ?? []
  };
}

async function promptOpenAi(ui: CoderUi, prev?: OpenAiCfg): Promise<OpenAiCfg | null> {
  const editAuth = await askYesNo(
    ui,
    "Edit authentication for this profile?",
    prev?.apiKey === undefined
  );
  if (editAuth === null) return null;

  let apiKey = prev?.apiKey;
  let baseUrl = prev?.baseUrl;
  if (editAuth) {
    const nextApiKey = await askValidated(
      ui,
      "OPENAI_API_KEY: ",
      prev?.apiKey ?? "",
      validators.nonEmpty
    );
    if (nextApiKey === null) return null;
    apiKey = nextApiKey;
    const nextBaseUrl = await askWithDefault(
      ui,
      "OPENAI_BASE_URL (blank = OpenAI default): ",
      prev?.baseUrl ?? ""
    );
    if (nextBaseUrl === null) return null;
    if (nextBaseUrl.length > 0) {
      const ok = validators.apiUrl(nextBaseUrl);
      if (ok !== true) {
        printWarning(ui, ok);
        return promptOpenAi(ui, { ...prev, apiKey, baseUrl: nextBaseUrl } as OpenAiCfg);
      }
    }
    baseUrl = nextBaseUrl || undefined;
  }

  const model = await askWithDefault(ui, "Model (blank = codex default): ", prev?.model ?? "");
  if (model === null) return null;

  const fullAuto = await askYesNo(
    ui,
    "Use --full-auto (sandbox=workspace-write, approval=never)?",
    prev?.fullAuto ?? true
  );
  if (fullAuto === null) return null;

  const bypassApprovalsAndSandbox = await askYesNo(
    ui,
    "Use --dangerously-bypass-approvals-and-sandbox?",
    prev?.bypassApprovalsAndSandbox ?? false
  );
  if (bypassApprovalsAndSandbox === null) return null;

  return {
    apiKey,
    baseUrl,
    model: model || undefined,
    sandboxMode: prev?.sandboxMode,
    approvalMode: prev?.approvalMode,
    fullAuto,
    bypassApprovalsAndSandbox,
    extraArgs: prev?.extraArgs ?? []
  };
}

async function promptCustom(ui: CoderUi, prev?: CustomCfg): Promise<CustomCfg | null> {
  const launchBin = await askValidated(
    ui,
    "Launch binary (path or name): ",
    prev?.launchBin ?? "",
    (value): true | string => {
      const nonEmpty = validators.nonEmpty(value);
      if (nonEmpty !== true) return nonEmpty;
      if (/\s/.test(value)) return "Use a single binary name or path without spaces";
      return true;
    }
  );
  if (launchBin === null) return null;

  const argsRaw = await askWithDefault(
    ui,
    "Args (space-separated; blank for none): ",
    prev?.args.join(" ") ?? ""
  );
  if (argsRaw === null) return null;

  const messagePlacement = await pickWithArrows<"appended" | "stdin" | "placeholder" | "__BACK__">(
    ui,
    "Message Placement",
    "Where should the instruction text go?",
    [
      { label: "Appended as the last argument (default)", value: "appended" },
      { label: "Written to the child's stdin", value: "stdin" },
      { label: "Substitute `$message` in args", value: "placeholder" },
      { label: "Back", value: "__BACK__" }
    ],
    messagePlacementChoiceIndex(prev?.messagePlacement)
  );
  if (messagePlacement === null || messagePlacement === "__BACK__") return null;

  const envRaw = await askWithDefault(
    ui,
    "Extra env (KEY=value space-separated; blank for none): ",
    prev ? formatEnvRaw(prev.env) : ""
  );
  if (envRaw === null) return null;

  return {
    launchBin,
    args: parseArgsRaw(argsRaw),
    env: parseEnvRaw(envRaw),
    messagePlacement
  };
}

async function promptProfileEditor(
  ui: CoderUi,
  existing: Profile | undefined,
  takenNames: Set<string>
): Promise<Profile | null> {
  clearScreen();
  printBanner(ui);
  printSection(ui, existing ? "Update Profile" : "Add Profile");

  const tool = await pickTool(ui, existing?.tool);
  if (tool === null) return null;

  const name = await askValidated(
    ui,
    "Profile name: ",
    existing?.name ?? "",
    (value): true | string => {
      const valid = validators.profileName(value);
      if (valid !== true) return valid;
      return takenNames.has(value) ? "A profile with that name already exists" : true;
    }
  );
  if (name === null) return null;

  const cwd = await askValidated(
    ui,
    "Working directory for this profile: ",
    existing?.cwd ?? process.cwd(),
    validators.nonEmpty
  );
  if (cwd === null) return null;

  const metadata = await askWithDefault(ui, "Metadata/notes (optional): ", existing?.metadata ?? "");
  if (metadata === null) return null;

  if (tool === "CLAUDE_CODE") {
    const prev = existing?.tool === "CLAUDE_CODE" ? existing.claudeCode : undefined;
    const claude = await promptClaude(ui, prev);
    if (claude === null) return null;
    return {
      name,
      cwd,
      tool: "CLAUDE_CODE",
      metadata: metadata || undefined,
      claudeCode: claude
    };
  }

  if (tool === "OPENAI") {
    const prev = existing?.tool === "OPENAI" ? existing.codex : undefined;
    const codex = await promptOpenAi(ui, prev);
    if (codex === null) return null;
    return {
      name,
      cwd,
      tool: "OPENAI",
      metadata: metadata || undefined,
      codex
    };
  }

  const prev = existing?.tool === "CUSTOM" ? existing.custom : undefined;
  const custom = await promptCustom(ui, prev);
  if (custom === null) return null;
  return {
    name,
    cwd,
    tool: "CUSTOM",
    metadata: metadata || undefined,
    custom
  };
}

async function addProfile(ui: CoderUi, profiles: Profile[]): Promise<void> {
  if (profiles.length >= MAX_PROFILES_PER_DAEMON) {
    printWarning(ui, `Max profiles reached (${MAX_PROFILES_PER_DAEMON}).`);
    await pause(ui);
    return;
  }
  const taken = new Set(profiles.map((p) => p.name));
  const profile = await promptProfileEditor(ui, undefined, taken);
  if (!profile) return;
  profiles.push(profile);
  printSuccess(ui, `Profile "${profile.name}" created`);
  await pause(ui);
}

async function updateProfile(ui: CoderUi, profiles: Profile[], index: number): Promise<void> {
  const existing = profiles[index];
  if (!existing) {
    printWarning(ui, "No profile selected");
    await pause(ui);
    return;
  }
  const taken = new Set(profiles.map((p) => p.name).filter((name) => name !== existing.name));
  const edited = await promptProfileEditor(ui, existing, taken);
  if (!edited) return;
  profiles[index] = edited;
  printSuccess(ui, `Profile "${edited.name}" updated`);
  await pause(ui);
}

async function confirmDelete(ui: CoderUi, promptText: string): Promise<boolean> {
  const ans = await ask(ui, `${promptText} (y/N): `);
  if (ans === null) return false;
  return /^y(es)?$/i.test(ans.trim());
}

async function deleteProfile(ui: CoderUi, profiles: Profile[], index: number): Promise<void> {
  const existing = profiles[index];
  if (!existing) {
    printWarning(ui, "No profile selected");
    await pause(ui);
    return;
  }

  clearScreen();
  printBanner(ui);
  printSection(ui, "Delete Profile");
  out(`${ui.BOLD}Selected profile${ui.RESET}`);
  out(`${ui.DIM}Tool:${ui.RESET} ${toolLabel(existing.tool)}`);
  out(`${ui.DIM}CWD:${ui.RESET} ${existing.cwd}`);
  out(`${ui.DIM}Metadata:${ui.RESET} ${existing.metadata ?? "<none>"}`);
  out("");

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
  printSuccess(ui, `Profile "${existing.name}" deleted`);
  await pause(ui);
}

async function manageProfiles(ui: CoderUi, profiles: Profile[]): Promise<boolean> {
  let page = 0;
  let selectedSlot = 0;
  for (;;) {
    const total = profiles.length;
    if (total === 0) {
      page = 0;
      selectedSlot = 0;
    } else {
      const pageCount = Math.ceil(total / LANDING_PAGE_SIZE);
      if (page >= pageCount) page = pageCount - 1;
      let lastSlot = total - page * LANDING_PAGE_SIZE - 1;
      if (lastSlot >= LANDING_PAGE_SIZE) lastSlot = LANDING_PAGE_SIZE - 1;
      if (selectedSlot > lastSlot) selectedSlot = lastSlot;
    }

    clearScreen();
    showSetupProfiles(ui, page, selectedSlot, profiles);
    showSetupFooter(ui);

    const key = await readKey();
    if (key === null) {
      printInfo(ui, "Input closed. Exiting.");
      return false;
    }
    if (key === "\u0003") process.exit(130);

    if (key === "\x1b[A") {
      if (total > 0 && selectedSlot > 0) selectedSlot -= 1;
      continue;
    }
    if (key === "\x1b[B") {
      if (total > 0) {
        let lastSlot = total - page * LANDING_PAGE_SIZE - 1;
        if (lastSlot >= LANDING_PAGE_SIZE) lastSlot = LANDING_PAGE_SIZE - 1;
        if (selectedSlot < lastSlot) selectedSlot += 1;
      }
      continue;
    }
    if (key === "\x1b[D") {
      if (total > 0 && page > 0) {
        page -= 1;
        selectedSlot = 0;
      }
      continue;
    }
    if (key === "\x1b[C") {
      if (total > 0 && (page + 1) * LANDING_PAGE_SIZE < total) {
        page += 1;
        selectedSlot = 0;
      }
      continue;
    }
    if (key === "") {
      if (total > 0) return true;
      printWarning(ui, "Add at least one profile before continuing");
      await pause(ui);
      continue;
    }
    if (key === "a" || key === "A") {
      await addProfile(ui, profiles);
      continue;
    }
    if (key === "u" || key === "U") {
      const idx = selectedProfileIndex(page, selectedSlot, total);
      if (idx === null) {
        printWarning(ui, "No profile selected");
        await pause(ui);
        continue;
      }
      await updateProfile(ui, profiles, idx);
      continue;
    }
    if (key === "d" || key === "D") {
      const idx = selectedProfileIndex(page, selectedSlot, total);
      if (idx === null) {
        printWarning(ui, "No profile selected");
        await pause(ui);
        continue;
      }
      await deleteProfile(ui, profiles, idx);
      continue;
    }
    if (key === "q" || key === "Q" || key === "0" || key === "\x1b") {
      return false;
    }

    printWarning(ui, "Invalid selection");
    await pause(ui);
  }
  return false;
}

async function promptApiUrl(ui: CoderUi, initial: string): Promise<string | null> {
  clearScreen();
  printBanner(ui);
  printSection(ui, "Bot Connection");
  return askValidated(ui, "Bot API URL (e.g. https://bot.example.com): ", initial, validators.apiUrl);
}

async function promptApiKey(ui: CoderUi, existing?: string): Promise<string | null> {
  const mode = await pickWithArrows<"generate" | "existing" | "abort">(
    ui,
    "API Key",
    "Choose how to configure your daemon API key.",
    [
      { label: "Generate a new key for me", value: "generate" },
      { label: "I'll paste one I already have", value: "existing" },
      { label: "Abort setup", value: "abort" }
    ],
    existing ? 1 : 0
  );
  if (mode === null || mode === "abort") return null;

  if (mode === "generate") {
    const { rawApiKey } = generateApiKey();
    clearScreen();
    printBanner(ui);
    printSection(ui, "API Key Generated");
    out(`Generated API key: ${rawApiKey}`);
    out("Copy this now — it will be stored only in your local config file.");
    await pause(ui);
    return rawApiKey;
  }

  clearScreen();
  printBanner(ui);
  printSection(ui, "API Key");
  return askValidated(ui, "Paste API key (≥16 chars): ", existing ?? "", validators.apiKey);
}

async function promptMaxConcurrency(ui: CoderUi, initial: number): Promise<number | null> {
  clearScreen();
  printBanner(ui);
  printSection(ui, "Daemon");
  let nextInitial = String(initial);
  for (;;) {
    const raw = await askWithDefault(ui, "Max concurrent child processes: ", nextInitial);
    if (raw === null) return null;
    const n = Number(raw.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 32) return n;
    printWarning(ui, "Enter an integer in range 1..32.");
    nextInitial = raw;
  }
  return null;
}

async function runSetupCoderStyle(
  existing: Partial<DaemonConfig> | undefined,
  targetPath: string
): Promise<string | null> {
  const ui = makeCoderUi();

  const apiUrl = await promptApiUrl(ui, existing?.apiUrl ?? "http://localhost:8080");
  if (apiUrl === null) {
    clearScreen();
    printInfo(ui, "Aborted.");
    return null;
  }

  const apiKey = await promptApiKey(ui, existing?.apiKey);
  if (apiKey === null) {
    clearScreen();
    printInfo(ui, "Aborted.");
    return null;
  }

  const profiles: Profile[] = seedProfiles(existing);
  const continueSetup = await manageProfiles(ui, profiles);
  if (!continueSetup) {
    clearScreen();
    printInfo(ui, "Aborted.");
    return null;
  }

  const maxConcurrency = await promptMaxConcurrency(ui, existing?.maxConcurrency ?? 4);
  if (maxConcurrency === null) {
    clearScreen();
    printInfo(ui, "Aborted.");
    return null;
  }

  const cfg = DaemonConfig.parse({
    apiUrl,
    apiKey,
    pollIntervalMs: existing?.pollIntervalMs,
    pollJitterMs: existing?.pollJitterMs,
    heartbeatIntervalMs: existing?.heartbeatIntervalMs,
    idleShutdownMs: existing?.idleShutdownMs,
    maxConcurrency,
    profiles
  });

  writeConfig(cfg, targetPath);
  syncOpenAiProfileHomes(cfg);

  clearScreen();
  printBanner(ui);
  printSection(ui, "Saved");
  printSuccess(ui, `wrote ${targetPath} (mode 0600)`);
  out(`• ${cfg.profiles.length} profile(s): ${cfg.profiles.map((p) => p.name).join(", ")}`);
  out("Start the coder service with: chatcoder coder");
  return targetPath;
}

/* -------------------------------------------------------------------------- */
/* Prompt wizard fallback (non-TTY + tests)                                   */
/* -------------------------------------------------------------------------- */

function clearIfTty(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1Bc");
  }
}

function printBannerSimple(io: SetupIO): void {
  io.log(LINE);
  io.log("  chatcoder coder --setup");
  io.log(LINE);
}

function printSectionSimple(io: SetupIO, title: string): void {
  io.log("");
  io.log(title);
  io.log(LINE);
}

function printProfilesSimple(io: SetupIO, profiles: Profile[]): void {
  if (profiles.length === 0) {
    io.log("No profiles yet.");
    return;
  }
  for (let i = 0; i < profiles.length; i += 1) {
    const p = profiles[i]!;
    io.log(`[${i + 1}] ${p.name} · ${toolLabel(p.tool)} · cwd=${p.cwd}`);
  }
}

async function promptOneProfilePromptWizard(
  io: SetupIO,
  index: number,
  takenNames: Set<string>,
  existing?: Profile
): Promise<Profile | null> {
  clearIfTty();
  printBannerSimple(io);
  printSectionSimple(io, existing ? `Update Profile #${index + 1}` : `Add Profile #${index + 1}`);

  const existingTool = existing?.tool;
  const base = await io.prompt([
    {
      type: "text",
      name: "name",
      message: "Profile name (shown in Telegram picker)",
      initial: existing?.name ?? "",
      validate: (value: string): true | string => {
        const ok = validators.profileName(value);
        if (ok !== true) return ok;
        return takenNames.has(value) ? "A profile with that name already exists" : true;
      }
    },
    {
      type: "text",
      name: "cwd",
      message: "Working directory for this profile",
      initial: existing?.cwd ?? process.cwd(),
      validate: validators.nonEmpty
    },
    {
      type: "select",
      name: "tool",
      message: "Tool",
      choices: [
        { title: "Claude Code (claude)", value: "CLAUDE_CODE" },
        { title: "OpenAI Codex (codex)", value: "OPENAI" },
        { title: "Custom binary", value: "CUSTOM" }
      ],
      initial: toolChoiceIndex(existingTool)
    },
    {
      type: "text",
      name: "metadata",
      message: "Metadata / notes (optional)",
      initial: existing?.metadata ?? ""
    }
  ]);

  if (!base.name || !base.cwd || !base.tool) return null;

  if (base.tool === "CLAUDE_CODE") {
    const prev = existing?.tool === "CLAUDE_CODE" ? existing.claudeCode : undefined;
    const auth = await io.prompt({
      type: "toggle",
      name: "editAuthentication",
      message: "Edit authentication for this profile?",
      initial: prev?.apiKey === undefined,
      active: "yes",
      inactive: "no"
    });
    if (auth.editAuthentication === undefined) return null;
    let apiKey = prev?.apiKey;
    let baseUrl = prev?.baseUrl;
    if (auth.editAuthentication) {
      const a = await io.prompt([
        {
          type: "password",
          name: "apiKey",
          message: "ANTHROPIC_API_KEY",
          initial: prev?.apiKey ?? "",
          validate: validators.nonEmpty
        },
        {
          type: "text",
          name: "baseUrl",
          message: "ANTHROPIC_BASE_URL (blank = default)",
          initial: prev?.baseUrl ?? ""
        }
      ]);
      if (!a.apiKey) return null;
      apiKey = a.apiKey;
      baseUrl = a.baseUrl || undefined;
    }
    const c = await io.prompt([
      {
        type: "text",
        name: "model",
        message: "Model (blank = Claude default)",
        initial: prev?.model ?? ""
      },
      {
        type: "toggle",
        name: "skipPermissions",
        message: "Pass --dangerously-skip-permissions?",
        initial: prev?.skipPermissions ?? true,
        active: "yes",
        inactive: "no"
      },
      {
        type: "select",
        name: "outputFormat",
        message: "Output format",
        choices: [
          { title: "text (default)", value: "text" },
          { title: "stream-json", value: "stream-json" }
        ],
        initial: outputFormatChoiceIndex(prev?.outputFormat)
      }
    ]);
    return {
      name: base.name,
      cwd: base.cwd,
      tool: "CLAUDE_CODE",
      metadata: base.metadata || undefined,
      claudeCode: {
        apiKey,
        baseUrl,
        model: c.model || undefined,
        skipPermissions: !!c.skipPermissions,
        outputFormat: c.outputFormat ?? "text",
        extraArgs: prev?.extraArgs ?? []
      }
    };
  }

  if (base.tool === "OPENAI") {
    const prev = existing?.tool === "OPENAI" ? existing.codex : undefined;
    const auth = await io.prompt({
      type: "toggle",
      name: "editAuthentication",
      message: "Edit authentication for this profile?",
      initial: prev?.apiKey === undefined,
      active: "yes",
      inactive: "no"
    });
    if (auth.editAuthentication === undefined) return null;
    let apiKey = prev?.apiKey;
    let baseUrl = prev?.baseUrl;
    if (auth.editAuthentication) {
      const a = await io.prompt([
        {
          type: "password",
          name: "apiKey",
          message: "OPENAI_API_KEY",
          initial: prev?.apiKey ?? "",
          validate: validators.nonEmpty
        },
        {
          type: "text",
          name: "baseUrl",
          message: "OPENAI_BASE_URL (blank = OpenAI default)",
          initial: prev?.baseUrl ?? ""
        }
      ]);
      if (!a.apiKey) return null;
      apiKey = a.apiKey;
      baseUrl = a.baseUrl || undefined;
    }
    const c = await io.prompt([
      {
        type: "text",
        name: "model",
        message: "Model (blank = codex default)",
        initial: prev?.model ?? ""
      },
      {
        type: "toggle",
        name: "fullAuto",
        message: "Use --full-auto (sandbox=workspace-write, approval=never)?",
        initial: prev?.fullAuto ?? true,
        active: "yes",
        inactive: "no"
      },
      {
        type: "toggle",
        name: "bypassApprovalsAndSandbox",
        message: "Use --dangerously-bypass-approvals-and-sandbox?",
        initial: prev?.bypassApprovalsAndSandbox ?? false,
        active: "yes",
        inactive: "no"
      }
    ]);
    return {
      name: base.name,
      cwd: base.cwd,
      tool: "OPENAI",
      metadata: base.metadata || undefined,
      codex: {
        apiKey,
        baseUrl,
        model: c.model || undefined,
        fullAuto: !!c.fullAuto,
        bypassApprovalsAndSandbox: !!c.bypassApprovalsAndSandbox,
        sandboxMode: prev?.sandboxMode,
        approvalMode: prev?.approvalMode,
        extraArgs: prev?.extraArgs ?? []
      }
    };
  }

  const prev = existing?.tool === "CUSTOM" ? existing.custom : undefined;
  const c = await io.prompt([
    {
      type: "text",
      name: "launchBin",
      message: "Launch binary (path or name)",
      initial: prev?.launchBin ?? "",
      validate: validators.nonEmpty
    },
    {
      type: "text",
      name: "argsRaw",
      message: "Args (space-separated; blank for none)",
      initial: prev?.args.join(" ") ?? ""
    },
    {
      type: "select",
      name: "messagePlacement",
      message: "Where should the instruction text go?",
      choices: [
        { title: "Appended as the last argument (default)", value: "appended" },
        { title: "Written to the child's stdin", value: "stdin" },
        { title: "Substitute `$message` in args", value: "placeholder" }
      ],
      initial: messagePlacementChoiceIndex(prev?.messagePlacement)
    },
    {
      type: "text",
      name: "envRaw",
      message: "Extra env (KEY=value space-separated; blank for none)",
      initial: prev ? formatEnvRaw(prev.env) : ""
    }
  ]);
  if (!c.launchBin) return null;
  return {
    name: base.name,
    cwd: base.cwd,
    tool: "CUSTOM",
    metadata: base.metadata || undefined,
    custom: {
      launchBin: c.launchBin,
      args: parseArgsRaw(c.argsRaw as string),
      env: parseEnvRaw(c.envRaw as string),
      messagePlacement: c.messagePlacement ?? "appended"
    }
  };
}

async function runSetupPromptWizard(
  existing?: Partial<DaemonConfig>,
  io: SetupIO = defaultIO,
  targetPath: string = defaultConfigPath()
): Promise<string | null> {
  clearIfTty();
  printBannerSimple(io);
  printSectionSimple(io, "Bot Connection");

  const topLevel = await io.prompt([
    {
      type: "text",
      name: "apiUrl",
      message: "Bot API URL (e.g. https://bot.example.com)",
      initial: existing?.apiUrl ?? "http://localhost:8080",
      validate: validators.apiUrl
    },
    {
      type: "select",
      name: "keyMode",
      message: "API key",
      choices: [
        { title: "Generate a new key for me", value: "generate" },
        { title: "I'll paste one I already have", value: "existing" }
      ],
      initial: existing?.apiKey ? 1 : 0
    }
  ]);
  if (!topLevel.apiUrl) {
    io.log("Aborted.");
    return null;
  }

  let apiKey: string;
  if (topLevel.keyMode === "generate") {
    const { rawApiKey } = generateApiKey();
    apiKey = rawApiKey;
    io.log(`Generated API key: ${apiKey}`);
    io.log("Copy this now — it will be stored only in your local config file.");
  } else {
    const ans = await io.prompt({
      type: "password",
      name: "apiKey",
      message: "Paste API key (≥16 chars)",
      initial: existing?.apiKey ?? "",
      validate: validators.apiKey
    });
    if (!ans.apiKey) {
      io.log("Aborted.");
      return null;
    }
    apiKey = ans.apiKey;
  }

  const profiles: Profile[] = seedProfiles(existing);
  let done = false;
  while (!done) {
    clearIfTty();
    printBannerSimple(io);
    printSectionSimple(io, "Profiles");
    printProfilesSimple(io, profiles);

    const choices: Array<{ title: string; value: "add" | "update" | "delete" | "continue" | "abort" }> = [];
    if (profiles.length < MAX_PROFILES_PER_DAEMON) {
      choices.push({ title: "Add profile", value: "add" });
    }
    if (profiles.length > 0) {
      choices.push({ title: "Update profile", value: "update" });
      choices.push({ title: "Delete profile", value: "delete" });
      choices.push({ title: "Continue", value: "continue" });
    }
    choices.push({ title: "Abort setup", value: "abort" });

    const actionAns = await io.prompt({
      type: "select",
      name: "action",
      message: "Profile actions",
      choices
    });
    const action = actionAns.action as "add" | "update" | "delete" | "continue" | "abort" | undefined;

    if (action === "abort" || !action) {
      io.log("Aborted.");
      return null;
    }
    if (action === "continue") {
      if (profiles.length === 0) {
        io.log("A daemon needs at least one profile.");
        continue;
      }
      done = true;
      continue;
    }
    if (action === "add") {
      const taken = new Set(profiles.map((p) => p.name));
      const profile = await promptOneProfilePromptWizard(io, profiles.length, taken);
      if (profile) profiles.push(profile);
      continue;
    }

    const picked = await io.prompt({
      type: "select",
      name: "idx",
      message: action === "update" ? "Select profile to update" : "Select profile to delete",
      choices: profiles.map((p, idx) => ({ title: `${p.name} (${toolLabel(p.tool)})`, value: idx }))
    });
    const idx = picked.idx as number | undefined;
    if (idx === undefined) continue;
    const selected = profiles[idx];
    if (!selected) continue;

    if (action === "delete") {
      const ok = await io.prompt({
        type: "toggle",
        name: "yes",
        message: `Delete "${selected.name}"?`,
        initial: false,
        active: "yes",
        inactive: "no"
      });
      if (ok.yes) profiles.splice(idx, 1);
      continue;
    }

    const taken = new Set(profiles.map((p) => p.name).filter((name) => name !== selected.name));
    const edited = await promptOneProfilePromptWizard(io, idx, taken, selected);
    if (edited) profiles[idx] = edited;
  }

  clearIfTty();
  printBannerSimple(io);
  printSectionSimple(io, "Daemon");
  const concurrency = await io.prompt({
    type: "number",
    name: "maxConcurrency",
    message: "Max concurrent child processes",
    initial: existing?.maxConcurrency ?? 4,
    min: 1,
    max: 32
  });

  const cfg = DaemonConfig.parse({
    apiUrl: topLevel.apiUrl,
    apiKey,
    pollIntervalMs: existing?.pollIntervalMs,
    pollJitterMs: existing?.pollJitterMs,
    heartbeatIntervalMs: existing?.heartbeatIntervalMs,
    idleShutdownMs: existing?.idleShutdownMs,
    maxConcurrency: concurrency.maxConcurrency ?? 4,
    profiles
  });
  writeConfig(cfg, targetPath);
  syncOpenAiProfileHomes(cfg);
  clearIfTty();
  printBannerSimple(io);
  printSectionSimple(io, "Saved");
  io.log(`✓ wrote ${targetPath} (mode 0600)`);
  io.log(`• ${cfg.profiles.length} profile(s): ${cfg.profiles.map((p) => p.name).join(", ")}`);
  io.log("Start the coder service with: chatcoder coder");
  return targetPath;
}

/* -------------------------------------------------------------------------- */

/** Interactive walkthrough. Returns the config path, or null on abort. */
export async function runSetup(
  existing?: Partial<DaemonConfig>,
  io: SetupIO = defaultIO,
  targetPath: string = defaultConfigPath()
): Promise<string | null> {
  if (canUseCoderStyle(io)) {
    return runSetupCoderStyle(existing, targetPath);
  }
  return runSetupPromptWizard(existing, io, targetPath);
}
