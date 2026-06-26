import { spawn } from "node:child_process";
function baseEnv() {
    const allow = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR"];
    const out = {};
    for (const key of allow) {
        const v = process.env[key];
        if (v !== undefined)
            out[key] = v;
    }
    return out;
}
/**
 * Launch a profile's tool interactively. Sets the profile's env vars,
 * spawns the tool binary with `inherit` stdio, and resolves when the
 * child exits.
 */
export async function launchProfile(profile, cwd) {
    const env = baseEnv();
    let cmd;
    let args;
    if (profile.tool === "CLAUDE_CODE") {
        const c = profile.claudeCode;
        if (c.baseUrl)
            env["ANTHROPIC_BASE_URL"] = c.baseUrl;
        if (c.authToken)
            env["ANTHROPIC_AUTH_TOKEN"] = c.authToken;
        if (c.defaultOpusModel)
            env["ANTHROPIC_DEFAULT_OPUS_MODEL"] = c.defaultOpusModel;
        if (c.defaultSonnetModel)
            env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = c.defaultSonnetModel;
        if (c.defaultHaikuModel)
            env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = c.defaultHaikuModel;
        if (c.disableNonessentialTraffic)
            env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "true";
        if (c.effortLevel)
            env["CLAUDE_CODE_EFFORT_LEVEL"] = c.effortLevel;
        args = [];
        if (c.model)
            args.push("--model", c.model);
        if (c.skipPermissions)
            args.push("--dangerously-skip-permissions");
        if (c.outputFormat && c.outputFormat !== "text") {
            args.push("--output-format", c.outputFormat);
        }
        args.push(...c.extraArgs);
        cmd = "claude";
    }
    else if (profile.tool === "OPENAI") {
        const c = profile.codex;
        if (c.apiKey)
            env["OPENAI_API_KEY"] = c.apiKey;
        if (c.baseUrl)
            env["OPENAI_BASE_URL"] = c.baseUrl;
        args = [];
        if (c.bypassApprovalsAndSandbox) {
            args.push("--dangerously-bypass-approvals-and-sandbox");
        }
        else if (c.fullAuto) {
            args.push("--full-auto");
        }
        else {
            if (c.sandboxMode)
                args.push("--sandbox", c.sandboxMode);
            if (c.approvalMode)
                args.push("--ask-for-approval", c.approvalMode);
        }
        if (c.model)
            args.push("--model", c.model);
        args.push(...c.extraArgs);
        cmd = "codex";
    }
    else if (profile.tool === "REASONIX") {
        const c = profile.reasonix;
        args = [];
        if (c.model)
            args.push("--model", c.model);
        args.push(...c.extraArgs);
        cmd = "reasonix";
    }
    else {
        const c = profile.custom;
        for (const [k, v] of Object.entries(c.env)) {
            env[k] = v;
        }
        args = [...c.args];
        cmd = c.launchBin;
    }
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: cwd ?? process.cwd(),
            env,
            stdio: "inherit"
        });
        child.on("close", (code) => resolve(code ?? 1));
        child.on("error", reject);
    });
}
//# sourceMappingURL=launcher.js.map