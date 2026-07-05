/** Options forwarded to whisper.cpp's CLI. */
export interface TranscriptionOptions {
    /** Number of CPU threads (default: 4). */
    threads?: number;
}
/**
 * Transcribe an OGG Opus audio buffer (as downloaded from Telegram) to text.
 *
 * @param audioBuffer  Raw OGG Opus bytes from the Telegram voice file.
 * @param opts         Optional tuning parameters.
 * @returns            The transcribed text, or an empty string on failure.
 */
export declare function transcribeAudio(audioBuffer: Buffer, opts?: TranscriptionOptions): Promise<string>;
//# sourceMappingURL=transcription.d.ts.map