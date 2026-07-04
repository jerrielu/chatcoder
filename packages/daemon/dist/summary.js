/**
 * Extract a summary field from tool output that may contain a JSON object
 * with a "summary" key. Handles markdown code fences and trailing text.
 */
export function extractSummaryFromJSON(output) {
    if (!output)
        return null;
    // Try to find a JSON object — look for { ... }
    // Handle markdown code fences: ```json ... ```
    let jsonStr = output;
    // Remove markdown code fences if present
    const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
    }
    // Find the first { and last }
    const start = jsonStr.indexOf("{");
    const end = jsonStr.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    jsonStr = jsonStr.slice(start, end + 1);
    try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === "object" && typeof parsed.summary === "string") {
            const summary = parsed.summary.trim();
            return summary.length > 0 ? summary : null;
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Extract the last non-empty block (paragraph) from output as a fallback.
 * Blocks are separated by one or more blank lines.
 */
export function extractLastBlock(output) {
    if (!output)
        return "";
    const blocks = output
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter((b) => b.length > 0);
    if (blocks.length === 0)
        return output.trim();
    return blocks[blocks.length - 1];
}
//# sourceMappingURL=summary.js.map