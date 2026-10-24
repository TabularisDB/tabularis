import type {CredentialProfile} from '@/api/contract';

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
