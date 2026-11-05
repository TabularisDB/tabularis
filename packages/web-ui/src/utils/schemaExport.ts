import type {Node, Edge} from '@xyflow/react';

export interface SchemaColumn {
    name: string;
    type?: string;
    isPk?: boolean;
    isFk?: boolean;
}

interface SchemaNodeData {
    label?: string;
    columns?: SchemaColumn[];
}

/**
 * Mermaid identifiers must not contain spaces or special characters. Anything
 * outside [A-Za-z0-9_] is replaced so the generated diagram stays parseable
 * with table names like "order details" or "public.users".
 */
export const sanitizeMermaidId = (name: string): string => {
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[0-9]/.test(cleaned) ? `t_${cleaned}` : cleaned;
};

/**
 * Mermaid attribute types share the same constraint, and an empty type would
 * produce an invalid line, so fall back to a placeholder.
 */
const sanitizeMermaidType = (type?: string): string => {
    if (!type) return 'unknown';
    const cleaned = type.replace(/[^A-Za-z0-9_]/g, '_');
    return cleaned.length > 0 ? cleaned : 'unknown';
};

/**
 * Builds a Mermaid `erDiagram` from the nodes and edges backing the ER view.
 *
 * Rendered natively by GitHub, GitLab and most documentation tools, so the
 * output can be pasted straight into a README.
 */
export const generateMermaidErDiagram = (nodes: Node[], edges: Edge[]): string => {
    const lines: string[] = ['erDiagram'];

    for (const node of nodes) {
        const data = (node.data ?? {}) as SchemaNodeData;
        const tableId = sanitizeMermaidId(String(data.label ?? node.id));
        const columns = data.columns ?? [];

        if (columns.length === 0) {
            lines.push(`    ${tableId} {`, `    }`);
            continue;
        }

        lines.push(`    ${tableId} {`);
        for (const column of columns) {
            const type = sanitizeMermaidType(column.type);
            const name = sanitizeMermaidId(column.name);
            const keys = [column.isPk ? 'PK' : null, column.isFk ? 'FK' : null]
                .filter(Boolean)
                .join(',');
            lines.push(`        ${type} ${name}${keys ? ` ${keys}` : ''}`);
        }
        lines.push(`    }`);
    }

    // The ER view draws one edge per foreign key column, so a composite FK would
    // otherwise produce duplicate relationship lines between the same two tables.
    const seen = new Set<string>();

    for (const edge of edges) {
        const source = sanitizeMermaidId(edge.source);
        const target = sanitizeMermaidId(edge.target);
        const label = edge.sourceHandle
            ? sanitizeMermaidId(String(edge.sourceHandle))
            : 'references';
        const key = `${source}|${target}|${label}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // The child table holds the foreign key, so it is the "many" side.
        lines.push(`    ${target} ||--o{ ${source} : "${label}"`);
    }

    return lines.join('\n') + '\n';
};

/**
 * DBML identifiers only need quoting when they are not plain words, so keep the
 * output readable and quote only when necessary.
 */
const quoteDbmlIdent = (name: string): string =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name}"`;

/**
 * Builds a DBML schema (https://dbml.dbdiagram.io) from the ER diagram data.
 *
 * Unlike Mermaid, DBML expresses relationships at column level, so a foreign
 * key keeps both endpoints instead of collapsing to a table-to-table edge. The
 * output round-trips through dbdiagram.io and dbml-to-sql.
 */
export const generateDbml = (nodes: Node[], edges: Edge[]): string => {
    const blocks: string[] = [];

    for (const node of nodes) {
        const data = (node.data ?? {}) as SchemaNodeData;
        const tableName = String(data.label ?? node.id);
        const columns = data.columns ?? [];
        const pkColumns = columns.filter((c) => c.isPk).map((c) => c.name);
        // A composite primary key cannot be expressed with per-column [pk]; DBML
        // requires an Indexes block listing the columns together.
        const isComposite = pkColumns.length > 1;

        const lines: string[] = [`Table ${quoteDbmlIdent(tableName)} {`];

        for (const column of columns) {
            const type = column.type ?? 'unknown';
            const settings = !isComposite && column.isPk ? ' [pk]' : '';
            lines.push(`  ${quoteDbmlIdent(column.name)} ${type}${settings}`);
        }

        if (isComposite) {
            lines.push(
                '',
                '  Indexes {',
                `    (${pkColumns.map(quoteDbmlIdent).join(', ')}) [pk]`,
                '  }',
            );
        }

        lines.push('}');
        blocks.push(lines.join('\n'));
    }

    const refs: string[] = [];
    const seen = new Set<string>();

    for (const edge of edges) {
        if (!edge.sourceHandle || !edge.targetHandle) continue;

        const child = `${quoteDbmlIdent(edge.source)}.${quoteDbmlIdent(String(edge.sourceHandle))}`;
        const parent = `${quoteDbmlIdent(edge.target)}.${quoteDbmlIdent(String(edge.targetHandle))}`;
        const ref = `Ref: ${child} > ${parent}`;
        if (seen.has(ref)) continue;
        seen.add(ref);
        refs.push(ref);
    }

    const out = [...blocks];
    if (refs.length > 0) out.push(refs.join('\n'));
    return out.join('\n\n') + '\n';
};

export interface MarkdownSchemaOptions {
    /** Schema (or database) the diagram was loaded from, shown in the header. */
    scope?: string;
}

/** Shown for a type, column or key endpoint the diagram has no metadata for. */
const MARKDOWN_UNKNOWN = '_unknown_';

const isWordChar = (char: string | undefined): boolean =>
    char !== undefined && /[A-Za-z0-9]/.test(char);

/**
 * Escapes a value for inline Markdown, including table cells.
 *
 * Characters that start inline syntax are backslash-escaped, `|` so it does not
 * split a table cell, and `& < >` become entities so names never render as
 * HTML. An underscore inside a word cannot start emphasis, so `user_id` is left
 * readable. Line breaks would end a table row, so they become a space.
 */
export const escapeMarkdownInline = (value: string): string =>
    value
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/[\\`*[\]|~#]/g, '\\$&')
        .replace(/_/g, (match, offset: number, text: string) =>
            isWordChar(text[offset - 1]) && isWordChar(text[offset + 1]) ? match : '\\_',
        )
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const markdownText = (value: string | undefined | null): string =>
    value == null || value.trim() === '' ? MARKDOWN_UNKNOWN : escapeMarkdownInline(value);

/**
 * Case-insensitive first so `Users` sits next to `users`, then by code point so
 * the order never depends on the user's locale.
 */
const compareIdentifiers = (a: string, b: string): number => {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
    if (a === b) return 0;
    return a < b ? -1 : 1;
};

const markdownRow = (cells: string[]): string => `| ${cells.join(' | ')} |`;

/**
 * File-based databases report their file path as the scope. The reference is
 * meant to be shared, so keep only the file name rather than leak the local
 * directory layout. Schema and database names pass through unchanged.
 */
export const describeMarkdownScope = (scope: string | undefined): string | undefined => {
    const trimmed = scope?.trim();
    if (!trimmed) return undefined;
    const isAbsolutePath = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(trimmed);
    if (!isAbsolutePath) return trimmed;
    const fileName = trimmed.split(/[\\/]/).filter(Boolean).pop();
    return fileName || undefined;
};

/**
 * Builds a Markdown reference of the tables, columns, keys and relationships
 * loaded in the ER diagram.
 *
 * Tables are keyed by node id, the identity the diagram itself uses, so two
 * tables with the same display label (e.g. in different schemas) stay
 * distinct. Tables are sorted by that identity and columns keep their defined
 * order, so the same diagram always produces the same file. Only metadata the
 * diagram already holds is written: missing types and endpoints are shown as
 * unknown rather than guessed.
 */
export const generateMarkdownSchema = (
    nodes: Node[],
    edges: Edge[],
    options: MarkdownSchemaOptions = {},
): string => {
    const tables = [...nodes].sort((a, b) => compareIdentifiers(a.id, b.id));
    const columnOrder = new Map<string, Map<string, number>>();

    const lines: string[] = ['# Schema reference', ''];
    const scope = describeMarkdownScope(options.scope);
    if (scope) lines.push(`Scope: ${escapeMarkdownInline(scope)}`, '');
    lines.push(
        `Covers the ${tables.length} ${tables.length === 1 ? 'table' : 'tables'} loaded in the ER diagram. ` +
            'It lists only the names, types, keys and relationships the diagram knows about; ' +
            'it is not complete database documentation.',
        '',
        '## Tables',
        '',
    );

    if (tables.length === 0) {
        lines.push('_No tables are loaded in the diagram._', '');
    }

    for (const table of tables) {
        const columns = ((table.data ?? {}) as SchemaNodeData).columns ?? [];
        columnOrder.set(table.id, new Map(columns.map((column, index) => [column.name, index])));

        lines.push(`### ${markdownText(table.id)}`, '');

        if (columns.length === 0) {
            lines.push('_No columns are loaded for this table._', '');
            continue;
        }

        lines.push(markdownRow(['Column', 'Type', 'Key']), markdownRow(['---', '---', '---']));
        for (const column of columns) {
            const keys = [column.isPk ? 'PK' : null, column.isFk ? 'FK' : null]
                .filter(Boolean)
                .join(', ');
            lines.push(markdownRow([markdownText(column.name), markdownText(column.type), keys]));
        }
        lines.push('');
    }

    // One edge is drawn per foreign key column, so a composite key arrives as
    // several edges between the same two tables. Each keeps its own row so no
    // column endpoint is lost; only exact duplicates are dropped.
    const seen = new Set<string>();
    const relationships = edges.filter((edge) => {
        const key = JSON.stringify([
            edge.source,
            edge.sourceHandle ?? null,
            edge.target,
            edge.targetHandle ?? null,
        ]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const columnIndex = (table: string, column: string | null | undefined): number =>
        column == null
            ? Number.MAX_SAFE_INTEGER
            : (columnOrder.get(table)?.get(column) ?? Number.MAX_SAFE_INTEGER);

    relationships.sort(
        (a, b) =>
            compareIdentifiers(a.source, b.source) ||
            compareIdentifiers(a.target, b.target) ||
            columnIndex(a.source, a.sourceHandle) - columnIndex(b.source, b.sourceHandle) ||
            compareIdentifiers(a.sourceHandle ?? '', b.sourceHandle ?? '') ||
            compareIdentifiers(a.targetHandle ?? '', b.targetHandle ?? ''),
    );

    lines.push('## Relationships', '');

    if (relationships.length === 0) {
        lines.push('_No relationships between the loaded tables._', '');
    } else {
        lines.push(
            markdownRow(['From table', 'From column', 'To table', 'To column']),
            markdownRow(['---', '---', '---', '---']),
        );
        for (const edge of relationships) {
            lines.push(
                markdownRow([
                    markdownText(edge.source),
                    markdownText(edge.sourceHandle),
                    markdownText(edge.target),
                    markdownText(edge.targetHandle),
                ]),
            );
        }
        lines.push('');
    }

    return lines.join('\n');
};
