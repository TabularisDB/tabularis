import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {CredentialProfilesManager} from '@/components/credentialProfiles/CredentialProfilesManager';
import type {CredentialProfile} from '@/utils/credentialProfiles';
import {CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE} from '@/utils/credentialProfileErrors';

const profileMocks = vi.hoisted(() => ({
    loadCredentialProfiles: vi.fn(),
    createCredentialProfile: vi.fn(),
    updateCredentialProfile: vi.fn(),
    deleteCredentialProfile: vi.fn(),
    validateCredentialProfileForm: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({
        call: (command: string, request: unknown) => invoke(command, request),
    }),
}));

vi.mock('lucide-react', () => ({
    Plus: () => null,
    Edit2: () => null,
    Trash2: () => null,
    Check: () => null,
    Eye: () => null,
    EyeOff: () => null,
    X: () => null,
    AlertTriangle: () => null,
}));

vi.mock('@/utils/credentialProfiles', () => ({
    loadCredentialProfiles: () => profileMocks.loadCredentialProfiles(),
    createCredentialProfile: (name: string, username: string, password: string) =>
        profileMocks.createCredentialProfile(name, username, password),
    updateCredentialProfile: (
        id: string,
        name: string,
        username: string,
        password: string | undefined,
    ) => profileMocks.updateCredentialProfile(id, name, username, password),
    deleteCredentialProfile: (id: string) => profileMocks.deleteCredentialProfile(id),
    validateCredentialProfileForm: profileMocks.validateCredentialProfileForm,
}));

const PROFILES: CredentialProfile[] = [
    {id: 'profile-1', name: 'Shared login', username: 'db_user'},
];

describe('CredentialProfilesManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        profileMocks.loadCredentialProfiles.mockResolvedValue(PROFILES);
        profileMocks.validateCredentialProfileForm.mockImplementation(
            (
                data: {name?: string; username?: string; password?: string},
                options: {requirePassword: boolean},
            ) => {
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
            },
        );
        profileMocks.createCredentialProfile.mockResolvedValue({
            id: 'profile-2',
            name: 'New',
            username: 'new_user',
        });
        profileMocks.updateCredentialProfile.mockResolvedValue(undefined);
        profileMocks.deleteCredentialProfile.mockResolvedValue(undefined);
    });

    it('shows the empty state when no profiles exist', async () => {
        profileMocks.loadCredentialProfiles.mockResolvedValue([]);
        render(<CredentialProfilesManager />);
        expect(await screen.findByText('credentialProfiles.noProfiles')).toBeInTheDocument();
    });

    it('lists loaded profiles with username metadata only', async () => {
        render(<CredentialProfilesManager />);
        expect(await screen.findByText('Shared login')).toBeInTheDocument();
        expect(screen.getByText(/credentialProfiles\.usernameLabel/)).toBeInTheDocument();
        expect(screen.queryByDisplayValue('db_user')).not.toBeInTheDocument();
    });

    it('creates a profile with name, username, and password', async () => {
        render(<CredentialProfilesManager />);
        await screen.findByText('Shared login');
        fireEvent.click(screen.getByText('credentialProfiles.createNew'));
        fireEvent.change(screen.getByPlaceholderText('credentialProfiles.namePlaceholder'), {
            target: {value: 'New profile'},
        });
        fireEvent.change(screen.getByPlaceholderText('credentialProfiles.usernamePlaceholder'), {
            target: {value: 'new_user'},
        });
        fireEvent.change(screen.getByPlaceholderText('credentialProfiles.passwordPlaceholder'), {
            target: {value: 'secret-password'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'credentialProfiles.save'}));
        await waitFor(() => {
            expect(profileMocks.createCredentialProfile).toHaveBeenCalledWith(
                'New profile',
                'new_user',
                'secret-password',
            );
        });
    });

    it('renames a profile without sending a password when rotation is left empty', async () => {
        render(<CredentialProfilesManager />);
        await screen.findByText('Shared login');
        fireEvent.click(screen.getByTitle('credentialProfiles.edit'));
        fireEvent.change(screen.getByPlaceholderText('credentialProfiles.namePlaceholder'), {
            target: {value: 'Renamed login'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'credentialProfiles.update'}));
        await waitFor(() => {
            expect(profileMocks.updateCredentialProfile).toHaveBeenCalledWith(
                'profile-1',
                'Renamed login',
                'db_user',
                undefined,
            );
        });
    });

    it('rotates the password when a new password is provided on edit', async () => {
        render(<CredentialProfilesManager />);
        await screen.findByText('Shared login');
        fireEvent.click(screen.getByTitle('credentialProfiles.edit'));
        fireEvent.change(
            screen.getByPlaceholderText('credentialProfiles.rotatePasswordPlaceholder'),
            {
                target: {value: 'rotated-secret'},
            },
        );
        fireEvent.click(screen.getByRole('button', {name: 'credentialProfiles.update'}));
        await waitFor(() => {
            expect(profileMocks.updateCredentialProfile).toHaveBeenCalledWith(
                'profile-1',
                'Shared login',
                'db_user',
                'rotated-secret',
            );
        });
    });

    it('deletes a profile after confirmation', async () => {
        render(<CredentialProfilesManager />);
        await screen.findByText('Shared login');
        fireEvent.click(screen.getByTitle('credentialProfiles.delete'));
        expect(await screen.findByText('credentialProfiles.confirmDelete')).toBeInTheDocument();
        fireEvent.click(screen.getByText('common.delete'));
        await waitFor(() => {
            expect(profileMocks.deleteCredentialProfile).toHaveBeenCalledWith('profile-1');
        });
    });

    it('surfaces blocked deletion with dependent connection names', async () => {
        profileMocks.deleteCredentialProfile.mockRejectedValue(
            JSON.stringify({
                code: CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE,
                message: 'blocked',
                connections: [{id: 'conn-1', name: 'Linked DB'}],
            }),
        );
        render(<CredentialProfilesManager />);
        await screen.findByText('Shared login');
        fireEvent.click(screen.getByTitle('credentialProfiles.delete'));
        fireEvent.click(await screen.findByText('common.delete'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            /credentialProfiles\.deleteBlocked/,
        );
    });
});
