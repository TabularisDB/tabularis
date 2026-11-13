import i18n from 'i18next';
import {MANAGED_CONNECTION_DENIED_CODE} from '@/api/session';

const MANAGED_DENIED_FALLBACK =
    'This connection is managed by an administrator and cannot be changed here.';

/** True for the backend's managed-mode denial, whatever message it carried. */
export function isManagedConnectionDenied(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as Record<string, unknown>).code === MANAGED_CONNECTION_DENIED_CODE
    );
}

/**
 * Safely extracts an error message from an unknown caught value.
 *
 * Handles Error instances, plain strings, and arbitrary types
 * without unsafe casts.
 */
export function toErrorMessage(err: unknown): string {
    // The code, not the server's text, selects the translated message.
    if (isManagedConnectionDenied(err)) {
        return (
            i18n.t('managed.denied', {defaultValue: MANAGED_DENIED_FALLBACK}) ||
            MANAGED_DENIED_FALLBACK
        );
    }
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    // Tauri invoke errors are often serialised as plain objects with a message field
    if (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        typeof (err as Record<string, unknown>).message === 'string'
    ) {
        return (err as Record<string, unknown>).message as string;
    }
    return String(err);
}

/**
 * Separator used when composing a user-facing error banner as
 * `${summary}\n\nError: ${technicalDetail}`.
 */
const ERROR_DETAILS_MARKER = '\n\nError: ';

/**
 * Splits a composed error banner message into its human-readable summary
 * and the (optional) technical detail that follows the `Error:` marker.
 *
 * When the marker is absent the whole message is treated as the summary
 * and `details` is `null`.
 */
export function splitErrorDetails(message: string): {
    summary: string;
    details: string | null;
} {
    const idx = message.indexOf(ERROR_DETAILS_MARKER);
    if (idx === -1) return {summary: message, details: null};
    const details = message.slice(idx + ERROR_DETAILS_MARKER.length).trim();
    return {
        summary: message.slice(0, idx),
        details: details.length > 0 ? details : null,
    };
}
