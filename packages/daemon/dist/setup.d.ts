import prompts from "prompts";
import { DaemonConfig } from "./config.js";
import type { Profile } from "./profile.js";
export interface SetupIO {
    prompt: typeof prompts;
    log: (msg: string) => void;
}
export declare const LANDING_PAGE_SIZE = 6;
export declare const validators: {
    apiUrl: (v: string) => true | string;
    apiKey: (v: string) => true | string;
    profileName: (v: string) => true | string;
    nonEmpty: (v: string) => true | string;
};
export declare function toolLabel(tool: Profile["tool"]): string;
export declare function toolChoiceIndex(tool: Profile["tool"] | undefined): number;
export interface CoderUi {
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
export interface PickerOption<T extends string> {
    label: string;
    value: T;
}
export declare function makeCoderUi(): CoderUi;
export declare function clearScreen(): void;
export declare function printLine(ui: CoderUi): void;
export declare function printBanner(ui: CoderUi): void;
export declare function printSection(ui: CoderUi, title: string): void;
export declare function printPickerOption(ui: CoderUi, selected: boolean, label: string): void;
export declare function footerItem(ui: CoderUi, key: string, label: string): string;
export declare function printInfo(ui: CoderUi, message: string): void;
export declare function printSuccess(ui: CoderUi, message: string): void;
export declare function printWarning(ui: CoderUi, message: string): void;
export declare function readKey(): Promise<string | null>;
export declare function askLine(promptText: string, initial?: string): Promise<string | null>;
export declare function ask(ui: CoderUi, promptText: string): Promise<string | null>;
export declare function askWithDefault(ui: CoderUi, promptText: string, initial: string): Promise<string | null>;
export declare function pause(ui: CoderUi): Promise<void>;
export declare function askValidated(ui: CoderUi, promptText: string, initial: string, validate: (v: string) => true | string): Promise<string | null>;
export declare function askYesNo(ui: CoderUi, promptText: string, initial: boolean): Promise<boolean | null>;
export declare function pickWithArrows<T extends string>(ui: CoderUi, section: string, promptText: string, options: Array<PickerOption<T>>, initial?: number): Promise<T | null>;
export declare function selectedProfileIndex(page: number, selectedSlot: number, total: number): number | null;
export declare function promptProfileEditor(ui: CoderUi, existing: Profile | undefined, takenNames: Set<string>): Promise<Profile | null>;
export declare function promptApiUrl(ui: CoderUi, initial: string): Promise<string | null>;
export declare function promptApiKey(ui: CoderUi, existing?: string): Promise<string | null>;
export declare function promptMaxConcurrency(ui: CoderUi, initial: number): Promise<number | null>;
/** Interactive walkthrough. Returns the config path, or null on abort. */
export declare function runSetup(existing?: Partial<DaemonConfig>, io?: SetupIO, targetPath?: string): Promise<string | null>;
//# sourceMappingURL=setup.d.ts.map