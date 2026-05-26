import type { Profile } from "./profile.js";
/**
 * Launch a profile's tool interactively. Sets the profile's env vars,
 * spawns the tool binary with `inherit` stdio, and resolves when the
 * child exits.
 */
export declare function launchProfile(profile: Profile, cwd?: string): Promise<number>;
//# sourceMappingURL=launcher.d.ts.map