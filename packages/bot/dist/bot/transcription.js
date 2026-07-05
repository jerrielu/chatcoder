/**
 * Local speech-to-text using whisper.cpp (bundled via whisper-node).
 *
 * Converts Telegram OGG/Opus voice messages to 16 kHz mono WAV, then
 * transcribes with the multilingual `base` Whisper model. Supports
 * English and Chinese (auto-detected).
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// ── Paths into the whisper-node installation ──────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** Resolve a path relative to this module, walking up to node_modules. */
function whisperCppPath(...segments) {
    // At runtime we are in packages/bot/dist/bot/transcription.js
    // Walk: dist/bot/ → dist/ → bot/ → packages/ → repo-root/
    const root = join(__dirname, "..", "..", "..", "..");
    return realpathSync(join(root, "node_modules", "whisper-node", "lib", "whisper.cpp", ...segments));
}
const WHISPER_CPP_DIR = whisperCppPath();
const MAIN_BIN = join(WHISPER_CPP_DIR, "build", "bin", "main");
const MODEL_PATH = join(WHISPER_CPP_DIR, "models", "ggml-base.bin");
/**
 * Transcribe an OGG Opus audio buffer (as downloaded from Telegram) to text.
 *
 * @param audioBuffer  Raw OGG Opus bytes from the Telegram voice file.
 * @param opts         Optional tuning parameters.
 * @returns            The transcribed text, or an empty string on failure.
 */
export async function transcribeAudio(audioBuffer, opts = {}) {
    const tmpId = `chatcoder-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const oggPath = join(tmpdir(), `${tmpId}.ogg`);
    const wavPath = join(tmpdir(), `${tmpId}.wav`);
    try {
        // 1. Write OGG bytes to a temp file
        writeFileSync(oggPath, audioBuffer);
        // 2. Convert to 16 kHz mono WAV via ffmpeg
        const ffmpegArgs = [
            "-y",
            "-i", oggPath,
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            "-f", "wav",
            wavPath,
        ];
        const ff = spawnSync("ffmpeg", ffmpegArgs, { stdio: "pipe", timeout: 30_000 });
        if (ff.status !== 0) {
            console.error("[transcription] ffmpeg error:", ff.stderr.toString());
            return "";
        }
        // 3. Transcribe with whisper.cpp (stdout gets plain-text transcript)
        const threads = opts.threads ?? 4;
        const whisperArgs = [
            "-m", MODEL_PATH,
            "-f", wavPath,
            "-l", "auto",
            "-t", String(threads),
        ];
        const ws = spawnSync(MAIN_BIN, whisperArgs, {
            stdio: "pipe",
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
        });
        if (ws.status !== 0) {
            console.error("[transcription] whisper error:", ws.stderr.toString());
            return "";
        }
        // 4. Parse output
        // Format per segment:  [HH:MM:SS.mmm --> HH:MM:SS.mmm]   text
        return parseWhisperOutput(ws.stdout.toString("utf-8"));
    }
    catch (err) {
        console.error("[transcription] failed:", err);
        return "";
    }
    finally {
        // 5. Clean up temp files
        try {
            unlinkSync(oggPath);
        }
        catch { /* ignore */ }
        try {
            unlinkSync(wavPath);
        }
        catch { /* ignore */ }
    }
}
// ── Parsing ────────────────────────────────────────────────────────────
const SEGMENT_RE = /\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s+(.*)/g;
/**
 * Parse whisper.cpp's stdout into a single text string.
 *
 * Extracts the speech portion from each segment line and concatenates
 * them with spaces.
 */
function parseWhisperOutput(stdout) {
    const parts = [];
    let match;
    const re = new RegExp(SEGMENT_RE);
    while ((match = re.exec(stdout)) !== null) {
        const speech = match[1]?.trim();
        if (speech)
            parts.push(speech);
    }
    return parts.join(" ");
}
//# sourceMappingURL=transcription.js.map