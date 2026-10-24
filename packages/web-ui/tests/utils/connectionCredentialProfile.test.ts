import {describe, expect, it} from 'vitest';
import {
    applySelectedCredentialProfile,
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
});
