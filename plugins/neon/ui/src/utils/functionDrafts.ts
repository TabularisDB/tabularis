export interface FunctionDraft {
    source: string;
    slug: string;
    language?: 'javascript' | 'typescript';
}

// Keep source edits across background tabs without persisting code or secrets in host settings.
const drafts = new Map<string, FunctionDraft>();
const key = (connectionId: string, slug: string) => JSON.stringify([connectionId, slug]);

export function readFunctionDraft(connectionId: string, slug: string): FunctionDraft | undefined {
    const draft = drafts.get(key(connectionId, slug));
    return draft ? {...draft} : undefined;
}

export function writeFunctionDraft(connectionId: string, slug: string, draft: FunctionDraft): void {
    drafts.set(key(connectionId, slug), {...draft});
}

export function clearFunctionDraft(connectionId: string, slug: string): void {
    drafts.delete(key(connectionId, slug));
}

export function validFunctionSlug(value: string): boolean {
    return /^[a-z0-9]{1,20}$/.test(value);
}

export function parseEnvironmentChanges(source: string): Record<string, string | null> {
    if (source.length > 65536) throw new Error('invalidEnvironment');
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch {
        throw new Error('invalidEnvironment');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('invalidEnvironment');
    const entries = Object.entries(parsed);
    if (
        entries.length > 64 ||
        entries.some(
            ([name, value]) =>
                !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) ||
                (value !== null && (typeof value !== 'string' || !value || value.includes('\0'))),
        )
    )
        throw new Error('invalidEnvironment');
    if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 24576)
        throw new Error('invalidEnvironment');
    return Object.fromEntries(entries) as Record<string, string | null>;
}

export const functionTemplate = `export default {
  fetch() {
    return Response.json({ message: "Hello from Tabularis" });
  },
};
`;
