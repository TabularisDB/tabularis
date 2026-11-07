/// <reference types="vite/client" />

/** Normalize a build-time mount path without accepting an origin or URL components. */
export function normalizeWebBasePath(value = '/'): string {
    if (value === '' || value === '/') return '/';
    if (!/^\/(?:[A-Za-z0-9_~.-]+\/)*[A-Za-z0-9_~.-]+\/?$/.test(value)) {
        throw new Error(
            'TABULARIS_BASE_PATH must be an absolute URL path, such as /tools/database/',
        );
    }
    const segments = value.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
        throw new Error('TABULARIS_BASE_PATH must not contain dot segments');
    }
    return `/${segments.join('/')}/`;
}

/** Prefix app-relative URLs at browser boundaries; router navigation stays relative to its basename. */
export function webPath(path: string, basePath = import.meta.env.BASE_URL): string {
    return `${normalizeWebBasePath(basePath)}${path.replace(/^\//, '')}`;
}
