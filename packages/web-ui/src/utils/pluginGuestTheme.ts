const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/** Theme tokens shared by current plugins and bundles using the legacy color prefix. */
export function pluginGuestThemeVariables(theme: Record<string, unknown>): Record<string, string> {
    const variables: Record<string, string> = {};
    const semanticNames: Record<string, string> = {primaryKey: 'pk', foreignKey: 'fk'};
    for (const [group, tokens] of Object.entries(record(theme.colors))) {
        for (const [token, value] of Object.entries(record(tokens))) {
            if (typeof value !== 'string') continue;
            const name = group === 'semantic' ? (semanticNames[token] ?? token) : token;
            variables[`--${group}-${name}`] = value;
            variables[`--color-${group}-${name}`] = value;
            if (group === 'border' && token === 'default') variables['--color-border'] = value;
        }
    }
    for (const [token, value] of Object.entries(record(record(theme.layout).borderRadius))) {
        if (typeof value === 'string') variables[`--radius-${token}`] = value;
    }
    const fonts = record(record(theme.typography).fontFamily);
    if (typeof fonts.base === 'string') variables['--font-sans'] = fonts.base;
    if (typeof fonts.mono === 'string') variables['--font-mono'] = fonts.mono;
    return variables;
}
