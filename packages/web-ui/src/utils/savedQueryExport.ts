import type {SavedQuery, SavedQueryFolder} from '@/contexts/SavedQueriesContext';

const FALLBACK_NAME = 'Untitled';

/** Collapses line breaks and control characters so a value stays on one comment line. */
function toCommentValue(value: string): string {
    return value.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ').trim();
}

function formatStatement(sql: string): string {
    const body = sql.trim().replace(/(?:\s*;)+$/, '');
    if (!body) return ';';
    // A trailing line comment or unterminated block comment would swallow the terminator.
    const lastLine = body.slice(body.lastIndexOf('\n') + 1);
    return lastLine.includes('--') || lastLine.includes('/*') ? `${body}\n;` : `${body};`;
}

/**
 * Serializes saved queries into one SQL script. Each query gets a `-- Name:`
 * header (plus `-- Folder:` when it belongs to a known folder) followed by its
 * SQL, always terminated with `;`. Names and folders are flattened to one line
 * so they cannot break out of their comment.
 */
export function formatSavedQueriesAsSql(
    queries: readonly SavedQuery[],
    folders: readonly SavedQueryFolder[],
): string {
    const folderNames = new Map(folders.map((f) => [f.id, f.name]));
    const blocks = queries.map((query) => {
        const lines = [`-- Name: ${toCommentValue(query.name) || FALLBACK_NAME}`];
        const folderName = query.folder_id ? folderNames.get(query.folder_id) : undefined;
        if (folderName !== undefined) {
            lines.push(`-- Folder: ${toCommentValue(folderName)}`);
        }
        lines.push(formatStatement(query.sql));
        return lines.join('\n');
    });
    return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}
