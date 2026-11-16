/**
 * Minimal single-pass ${VAR} substitution for template files.
 *
 * - `${NAME}` is replaced by `vars.NAME`.
 * - Unknown variables are left as-is (no error) so literal `${X}` in
 *   generated Rust/TS code survives.
 * - Per-format escaping (JSON, TOML) is the caller's responsibility — the
 *   template files should use already-escaped values, or use variables
 *   that contain safe content (slugs, version strings, booleans).
 */
export function substitute(source: string, vars: Record<string, string>): string {
    return source.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (match, name: string) => {
        const value = vars[name];
        return value === undefined ? match : value;
    });
}

/**
 * JSON-escape a string for safe embedding inside a JSON string literal.
 * Only used when a template variable is substituted inside quotes in a
 * `.json.tmpl` file and may contain special characters.
 */
export function jsonEscape(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}
