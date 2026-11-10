/** Returns an unused name for a copy of a saved query. */
export function getSavedQueryCopyName(name: string, existingNames: readonly string[]): string {
    const existing = new Set(existingNames);
    const first = `${name} (copy)`;
    if (!existing.has(first)) return first;

    let number = 2;
    while (existing.has(`${name} (copy ${number})`)) number++;
    return `${name} (copy ${number})`;
}
