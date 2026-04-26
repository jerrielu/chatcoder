import prompts from "prompts";
import { DaemonConfig } from "./config.js";
export interface SetupIO {
    prompt: typeof prompts;
    log: (msg: string) => void;
}
export declare const validators: {
    apiUrl: (v: string) => true | string;
    apiKey: (v: string) => true | string;
    profileName: (v: string) => true | string;
    nonEmpty: (v: string) => true | string;
};
/** Interactive walkthrough. Returns the config path, or null on abort. */
export declare function runSetup(existing?: Partial<DaemonConfig>, io?: SetupIO, targetPath?: string): Promise<string | null>;
//# sourceMappingURL=setup.d.ts.map