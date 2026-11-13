import {TabularisClientError} from '@/api/errors';
import {toErrorMessage} from '@/utils/errors';

export const CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE = 'credential_profile_delete_blocked';

export interface CredentialProfileDependentConnection {
    id: string;
    name: string;
}

export interface CredentialProfileDeleteBlockedError {
    code: string;
    message: string;
    connections: CredentialProfileDependentConnection[];
}

function parseBlockedPayload(raw: string): CredentialProfileDeleteBlockedError | null {
    try {
        const parsed = JSON.parse(raw) as CredentialProfileDeleteBlockedError;
        if (
            parsed.code === CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE &&
            Array.isArray(parsed.connections)
        ) {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * Recognises the structured delete-blocked payload returned by the backend,
 * whether the transport surfaced it as a plain string (Tauri) or inside a
 * client error message (web RPC).
 */
export function parseCredentialProfileDeleteBlockedError(
    error: unknown,
): CredentialProfileDeleteBlockedError | null {
    const candidates: string[] = [toErrorMessage(error)];
    if (error instanceof TabularisClientError) {
        candidates.push(error.message);
    }
    for (const raw of candidates) {
        const parsed = parseBlockedPayload(raw);
        if (parsed) {
            return parsed;
        }
    }
    return null;
}
