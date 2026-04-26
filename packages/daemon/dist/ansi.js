/**
 * Strip ANSI escape sequences so the Telegram user sees plain text. This
 * covers the sequences codex typically emits (colors, cursor, erase).
 */
const ANSI_RE = 
// eslint-disable-next-line no-control-regex
/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z0-9]*(?:;[a-zA-Z0-9]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;
export function stripAnsi(s) {
    return s.replace(ANSI_RE, "");
}
//# sourceMappingURL=ansi.js.map