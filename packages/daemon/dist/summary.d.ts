/**
 * Extract a summary field from tool output that may contain a JSON object
 * with a "summary" key. Handles markdown code fences and trailing text.
 */
export declare function extractSummaryFromJSON(output: string): string | null;
/**
 * Extract the last non-empty block (paragraph) from output as a fallback.
 * Blocks are separated by one or more blank lines.
 */
export declare function extractLastBlock(output: string): string;
//# sourceMappingURL=summary.d.ts.map