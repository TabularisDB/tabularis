import type {CredentialProfile, TypedCommandCaller} from '@/api/contract';
import {TauriTransport} from '@/api/transports/tauriTransport';

export type {CredentialProfile} from '@/api/contract';

const legacyTauriClient = new TauriTransport();

function commandClient(client?: TypedCommandCaller): TypedCommandCaller {
    return client ?? legacyTauriClient;
}

export async function loadCredentialProfiles(
    client?: TypedCommandCaller,
): Promise<CredentialProfile[]> {
    try {
        const profiles = await commandClient(client).call('list_credential_profiles', undefined);
        return Array.isArray(profiles) ? profiles : [];
    } catch (error) {
        console.error('Failed to load credential profiles:', error);
        return [];
    }
}

export async function createCredentialProfile(
    name: string,
    username: string,
    password: string,
    client?: TypedCommandCaller,
): Promise<CredentialProfile> {
    return await commandClient(client).call('create_credential_profile', {
        name: name.trim(),
        username: username.trim(),
        password,
    });
}

export async function updateCredentialProfile(
    id: string,
    name: string,
    username: string,
    password: string | undefined,
    client?: TypedCommandCaller,
): Promise<void> {
    const payload: {id: string; name: string; username: string; password?: string} = {
        id,
        name: name.trim(),
        username: username.trim(),
    };
    if (password !== undefined && password.length > 0) {
        payload.password = password;
    }
    await commandClient(client).call('update_credential_profile', payload);
}

export async function deleteCredentialProfile(
    id: string,
    client?: TypedCommandCaller,
): Promise<void> {
    await commandClient(client).call('delete_credential_profile', {id});
}

export interface CredentialProfileDependentConnection {
    id: string;
    name: string;
}

/**
 * Connections that reference a profile, resolved from the redacted connection
 * list so the delete confirmation can name them before the backend guard runs.
 * Passwords and other secrets are stripped from that list by the backend.
 */
export async function getCredentialProfileDependents(
    id: string,
    client?: TypedCommandCaller,
): Promise<CredentialProfileDependentConnection[]> {
    const connections = await commandClient(client).call('get_connections', undefined);
    return connections
        .filter((connection) => connection.params.credential_profile_id === id)
        .map((connection) => ({id: connection.id, name: connection.name}));
}

export function validateCredentialProfileForm(
    data: {name?: string; username?: string; password?: string},
    options: {requirePassword: boolean},
): {isValid: boolean; errorKey?: string} {
    if (!data.name?.trim()) {
        return {isValid: false, errorKey: 'credentialProfiles.errors.nameRequired'};
    }
    if (!data.username?.trim()) {
        return {isValid: false, errorKey: 'credentialProfiles.errors.usernameRequired'};
    }
    if (options.requirePassword && !data.password?.trim()) {
        return {isValid: false, errorKey: 'credentialProfiles.errors.passwordRequired'};
    }
    return {isValid: true};
}
