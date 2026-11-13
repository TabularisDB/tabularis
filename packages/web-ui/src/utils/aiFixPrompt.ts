/**
 * Builds the prompt that pre-fills the AI query dialog for a failed query.
 * Only the brief error message is used: details after the first blank line
 * (stack traces and the like) would just add noise to the prompt.
 */
export function buildFixQueryPrompt(sql: string, error: string): string {
    const separatorIndex = error.indexOf('\n\n');
    const brief = (separatorIndex === -1 ? error : error.slice(0, separatorIndex)).trim();
    return `Fix this query. It failed with: ${brief}\n\n${sql.trim()}`;
}
