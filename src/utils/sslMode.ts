/** Hosts that never leave the machine. Compared case-insensitively after trim. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * True when `host` is unset, a loopback address, a Unix socket path, or a
 * local named pipe. Anything else is treated as a remote host.
 */
export function isLocalDatabaseHost(host: string | null | undefined): boolean {
    const trimmed = (host ?? '').trim();
    if (trimmed.length === 0) return true;
    if (LOOPBACK_HOSTS.has(trimmed.toLowerCase())) return true;
    // Unix socket directory or path, including Linux abstract-namespace sockets.
    if (trimmed.startsWith('/') || trimmed.startsWith('@')) return true;
    // Windows named pipe (`\\.\pipe\...` or `\\?\pipe\...`).
    if (/^\\\\[.?]\\pipe\\/i.test(trimmed)) return true;
    return false;
}

export type SslModeFamily = 'postgres' | 'mysql';

const VERIFYING_SSL_MODES: Record<SslModeFamily, ReadonlySet<string>> = {
    postgres: new Set(['verify-ca', 'verify-full']),
    mysql: new Set(['verify_ca', 'verify-ca', 'verify_identity', 'verify-full', 'verify-identity']),
};

/** True when the mode checks the server certificate (chain, hostname, or both). */
export function sslModeVerifiesCertificate(mode: string, family: SslModeFamily): boolean {
    return VERIFYING_SSL_MODES[family].has(mode.trim().toLowerCase());
}

/** Mode to suggest when the selected one does not verify the server certificate. */
export function suggestedVerifyingSslMode(family: SslModeFamily): string {
    return family === 'postgres' ? 'verify-full' : 'verify_identity';
}

/**
 * Whether the SSL mode select should hint that a remote connection will not
 * verify the server certificate.
 */
export function shouldShowUnverifiedSslHint(
    host: string | null | undefined,
    mode: string,
    family: SslModeFamily,
): boolean {
    return !isLocalDatabaseHost(host) && !sslModeVerifiesCertificate(mode, family);
}
