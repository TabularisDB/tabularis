const SLUG_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const RESERVED_NAMES = new Set([
    'plugin',
    'plugins',
    'tabularis',
    'tabularis-plugin',
    'test',
    'tests',
]);

/**
 * Slugify a free-form name into a valid plugin id.
 *
 * Accepts: "My Driver!", "my-driver", "My_Driver". Returns a kebab-case,
 * lowercase, hyphen-only string that matches `^[a-z][a-z0-9-]*[a-z0-9]$`.
 */
export function slugify(raw: string): string {
    return raw
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

/**
 * Title-case a slug for display. "my-driver" → "My Driver".
 */
export function titleCase(slug: string): string {
    return slug
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

export interface NameValidation {
    ok: boolean;
    slug: string;
    reason?: string;
}

export function validateName(raw: string): NameValidation {
    const slug = slugify(raw);
    if (!slug) return {ok: false, slug: '', reason: 'name is empty after slugifying'};
    if (slug.length < 2) return {ok: false, slug, reason: 'name must be at least 2 characters'};
    if (slug.length > 64) return {ok: false, slug, reason: 'name must be at most 64 characters'};
    if (!SLUG_RE.test(slug)) {
        return {
            ok: false,
            slug,
            reason: 'name must match /^[a-z][a-z0-9-]*[a-z0-9]$/',
        };
    }
    if (RESERVED_NAMES.has(slug)) {
        return {ok: false, slug, reason: `"${slug}" is reserved`};
    }
    return {ok: true, slug};
}

export type DbType = 'network' | 'file' | 'folder' | 'api';

export function validateDbType(raw: string | undefined): DbType {
    const value = (raw ?? 'network').toLowerCase();
    if (value === 'network' || value === 'file' || value === 'folder' || value === 'api') {
        return value;
    }
    throw new Error(`Invalid --db-type "${raw}". Expected one of: network, file, folder, api.`);
}

export type IdentifierQuote = '"' | '`';

export function validateQuote(raw: string | undefined): IdentifierQuote {
    const value = raw ?? '"';
    if (value === '"' || value === '`') return value;
    throw new Error(`Invalid --quote "${raw}". Expected one of: "  |  \``);
}
