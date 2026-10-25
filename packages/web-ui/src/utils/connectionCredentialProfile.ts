import type {CredentialProfile} from '@/api/contract';
import {toErrorMessage} from '@/utils/errors';

export const INLINE_CREDENTIAL_PROFILE_VALUE = '';

export interface ConnectionCredentialFields {
    credential_profile_id?: string;
    username?: string;
    password?: string;
    use_iam_auth?: boolean;
}

export function findCredentialProfile(
    profiles: CredentialProfile[],
    profileId: string | undefined,
): CredentialProfile | undefined {
    if (!profileId) {
        return undefined;
    }
    return profiles.find((profile) => profile.id === profileId);
}

export function isCredentialProfileLinked(
    params: Pick<ConnectionCredentialFields, 'credential_profile_id'>,
): boolean {
    return Boolean(params.credential_profile_id?.trim());
}

export function shouldShowDatabasePasswordField(options: {
    credentialProfileId?: string;
    credentialFieldsHidden: boolean;
    passwordFieldHidden: boolean;
    useIamAuth: boolean;
}): boolean {
    if (options.credentialFieldsHidden || options.passwordFieldHidden) {
        return false;
    }
    if (options.credentialProfileId && !options.useIamAuth) {
        return false;
    }
    return true;
}

export function shouldLockUsernameToProfile(options: {
    credentialProfileId?: string;
    credentialFieldsHidden: boolean;
}): boolean {
    return Boolean(options.credentialProfileId && !options.credentialFieldsHidden);
}

/**
 * Strips inline DB secrets that must not be sent when a shared profile owns the login.
 * Profile passwords are never edited through ordinary connection saves.
 */
export function stripInlineSecretsForCredentialProfile<T extends ConnectionCredentialFields>(
    params: T,
): T {
    if (!isCredentialProfileLinked(params)) {
        return params;
    }
    const next = {...params};
    delete next.password;
    return next;
}

export interface SaveAsCredentialProfileRollbackState {
    createdProfileId?: string;
    connectionPersistenceCommitted: boolean;
    persistenceOutcomeUncertain: boolean;
}

/**
 * Backend validation errors returned before `save_connections_file` commits.
 * Transport failures and generic RPC rejections are treated as ambiguous.
 */
export function isProvablyPrePersistenceConnectionSaveError(error: unknown): boolean {
    const message = toErrorMessage(error).trim();
    if (!message) {
        return false;
    }
    if (/^Credential profile/i.test(message)) {
        return true;
    }
    if (/^Invalid environment:/i.test(message)) {
        return true;
    }
    return false;
}

export function applySaveAsPersistenceErrorToRollbackState(
    state: SaveAsCredentialProfileRollbackState,
    error: unknown,
): void {
    if (!isProvablyPrePersistenceConnectionSaveError(error)) {
        state.persistenceOutcomeUncertain = true;
    }
}

/** Deletes a save-as profile only when creation succeeded and connection persistence did not. */
export function shouldRollbackSaveAsCredentialProfile(
    state: SaveAsCredentialProfileRollbackState,
): boolean {
    if (!state.createdProfileId?.trim()) {
        return false;
    }
    if (state.connectionPersistenceCommitted) {
        return false;
    }
    if (state.persistenceOutcomeUncertain) {
        return false;
    }
    return true;
}

export function applySelectedCredentialProfile(
    profile: CredentialProfile | undefined,
): Pick<ConnectionCredentialFields, 'credential_profile_id' | 'username' | 'password'> {
    if (!profile) {
        return {
            password: '',
        };
    }
    return {
        credential_profile_id: profile.id,
        username: profile.username,
        password: '',
    };
}
