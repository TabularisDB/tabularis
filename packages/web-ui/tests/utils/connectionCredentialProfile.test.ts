import {describe, expect, it} from 'vitest';
import {
    applySaveAsPersistenceErrorToRollbackState,
    applySelectedCredentialProfile,
    isProvablyPrePersistenceConnectionSaveError,
    shouldRollbackSaveAsCredentialProfile,
    shouldShowDatabasePasswordField,
    stripInlineSecretsForCredentialProfile,
} from '@/utils/connectionCredentialProfile';

describe('connectionCredentialProfile', () => {
    it('strips inline passwords when a profile is linked', () => {
        const params = stripInlineSecretsForCredentialProfile({
            credential_profile_id: 'profile-1',
            username: 'app',
            password: 'must-not-leak',
        });
        expect(params.password).toBeUndefined();
        expect(params.credential_profile_id).toBe('profile-1');
    });

    it('hides the password field for profile-linked non-IAM connections', () => {
        expect(
            shouldShowDatabasePasswordField({
                credentialProfileId: 'profile-1',
                credentialFieldsHidden: false,
                passwordFieldHidden: false,
                useIamAuth: false,
            }),
        ).toBe(false);
    });

    it('keeps the password field for IAM tokens even with a profile', () => {
        expect(
            shouldShowDatabasePasswordField({
                credentialProfileId: 'profile-1',
                credentialFieldsHidden: false,
                passwordFieldHidden: false,
                useIamAuth: true,
            }),
        ).toBe(true);
    });

    it('applies profile metadata when selecting a shared profile', () => {
        expect(
            applySelectedCredentialProfile({
                id: 'profile-1',
                name: 'Shared',
                username: 'db_user',
            }),
        ).toEqual({
            credential_profile_id: 'profile-1',
            username: 'db_user',
            password: '',
        });
    });

    it('clears profile linkage when selecting inline credentials', () => {
        expect(applySelectedCredentialProfile(undefined)).toEqual({password: ''});
        expect(applySelectedCredentialProfile(undefined)).not.toHaveProperty(
            'credential_profile_id',
        );
    });

    describe('shouldRollbackSaveAsCredentialProfile', () => {
        it('rolls back only before connection persistence commits', () => {
            expect(
                shouldRollbackSaveAsCredentialProfile({
                    createdProfileId: 'profile-new',
                    connectionPersistenceCommitted: false,
                    persistenceOutcomeUncertain: false,
                }),
            ).toBe(true);
            expect(
                shouldRollbackSaveAsCredentialProfile({
                    createdProfileId: 'profile-new',
                    connectionPersistenceCommitted: true,
                    persistenceOutcomeUncertain: false,
                }),
            ).toBe(false);
        });

        it('does not roll back when persistence outcome is uncertain', () => {
            expect(
                shouldRollbackSaveAsCredentialProfile({
                    createdProfileId: 'profile-new',
                    connectionPersistenceCommitted: false,
                    persistenceOutcomeUncertain: true,
                }),
            ).toBe(false);
        });
    });

    describe('connection save persistence errors', () => {
        it('treats backend validation failures as provably pre-persistence', () => {
            expect(
                isProvablyPrePersistenceConnectionSaveError(
                    new Error("Credential profile 'missing' not found"),
                ),
            ).toBe(true);
            expect(isProvablyPrePersistenceConnectionSaveError(new Error('save failed'))).toBe(
                false,
            );
        });

        it('marks ambiguous save RPC failures as uncertain rollback state', () => {
            const state = {
                createdProfileId: 'profile-new',
                connectionPersistenceCommitted: false,
                persistenceOutcomeUncertain: false,
            };
            applySaveAsPersistenceErrorToRollbackState(state, new Error('save failed'));
            expect(state.persistenceOutcomeUncertain).toBe(true);
            expect(shouldRollbackSaveAsCredentialProfile(state)).toBe(false);
        });

        it('keeps rollback eligible for provably pre-persistence save failures', () => {
            const state = {
                createdProfileId: 'profile-new',
                connectionPersistenceCommitted: false,
                persistenceOutcomeUncertain: false,
            };
            applySaveAsPersistenceErrorToRollbackState(
                state,
                new Error("Credential profile 'missing' not found"),
            );
            expect(state.persistenceOutcomeUncertain).toBe(false);
            expect(shouldRollbackSaveAsCredentialProfile(state)).toBe(true);
        });
    });
});
