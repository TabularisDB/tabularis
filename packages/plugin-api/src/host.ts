import type {TabularisHostApi} from './types';
import {MIN_HOST_VERSION} from './version';

declare global {
    interface Window {
        __TABULARIS_API__?: TabularisHostApi;
        __TABULARIS_API_VERSION__?: string;
    }
}

function hostLookup(): TabularisHostApi | undefined {
    if (typeof globalThis === 'undefined') return undefined;
    const w = globalThis as typeof globalThis & {
        __TABULARIS_API__?: TabularisHostApi;
    };
    return w.__TABULARIS_API__;
}

/**
 * Return the host-injected API. Throws a clear error when the bundle runs
 * outside Tabularis (e.g. Storybook without a mock), which is the most
 * common confusion when developing a plugin UI extension.
 */
export function getHost(): TabularisHostApi {
    const api = hostLookup();
    if (!api) {
        throw new Error(
            '[@tabularis/plugin-api] Host API not found. ' +
                'This bundle is designed to run inside Tabularis — the host injects ' +
                'window.__TABULARIS_API__ at load time. If you are testing locally, ' +
                'run the component inside Tabularis as described in the plugin guide.',
        );
    }
    return api;
}

/**
 * Parse a "X.Y.Z" semver-ish string into a [major, minor, patch] tuple.
 * Non-numeric parts are treated as 0. Good enough for v0.x compat gates.
 */
function parseVersion(v: string): [number, number, number] {
    const parts = v.split('.').map((p) => Number.parseInt(p, 10));
    return [
        Number.isFinite(parts[0]) ? (parts[0] as number) : 0,
        Number.isFinite(parts[1]) ? (parts[1] as number) : 0,
        Number.isFinite(parts[2]) ? (parts[2] as number) : 0,
    ];
}

function versionGte(candidate: string, baseline: string): boolean {
    const [a1, a2, a3] = parseVersion(candidate);
    const [b1, b2, b3] = parseVersion(baseline);
    if (a1 !== b1) return a1 > b1;
    if (a2 !== b2) return a2 > b2;
    return a3 >= b3;
}

/**
 * Opt-in compatibility check. Plugin authors can call this at the top of
 * their entry component to fail fast when running against an older host.
 * Not called automatically — see version.ts for the automatic path planned
 * for v0.2.
 */
export function assertHostCompat(min: string = MIN_HOST_VERSION): void {
    const hostVersion =
        (typeof globalThis !== 'undefined'
            ? (globalThis as {__TABULARIS_API_VERSION__?: string}).__TABULARIS_API_VERSION__
            : undefined) ?? '0.0.0';
    if (!versionGte(hostVersion, min)) {
        throw new Error(
            `[@tabularis/plugin-api] Host version ${hostVersion} is older than required ${min}. ` +
                `Please update Tabularis.`,
        );
    }
}
