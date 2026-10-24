import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Settings} from 'lucide-react';
import clsx from 'clsx';
import {Select} from '@/components/ui/Select';
import type {CredentialProfile} from '@/api/contract';
import {
    INLINE_CREDENTIAL_PROFILE_VALUE,
    applySelectedCredentialProfile,
    findCredentialProfile,
} from '@/utils/connectionCredentialProfile';
import {createCredentialProfile, validateCredentialProfileForm} from '@/utils/credentialProfiles';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {toErrorMessage} from '@/utils/errors';

const LabelClass = 'text-[10px] uppercase font-semibold tracking-wider text-muted';

interface CredentialProfileConnectionFieldsProps {
    profiles: CredentialProfile[];
    credentialProfileId?: string;
    onCredentialProfileChange: (
        next: Pick<
            import('@/utils/connectionCredentialProfile').ConnectionCredentialFields,
            'credential_profile_id' | 'username' | 'password'
        >,
    ) => void;
    username: string;
    password: string;
    useIamAuth: boolean;
    disabled?: boolean;
    onManageProfiles: () => void;
    onProfilesRefresh: () => Promise<void>;
}

export function CredentialProfileConnectionFields({
    profiles,
    credentialProfileId,
    onCredentialProfileChange,
    username,
    password,
    useIamAuth,
    disabled = false,
    onManageProfiles,
    onProfilesRefresh,
}: CredentialProfileConnectionFieldsProps) {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const [saveAsOpen, setSaveAsOpen] = useState(false);
    const [saveAsName, setSaveAsName] = useState('');
    const [saveAsStatus, setSaveAsStatus] = useState<'idle' | 'error'>('idle');
    const [saveAsMessage, setSaveAsMessage] = useState('');

    const selectedProfile = findCredentialProfile(profiles, credentialProfileId);
    const missingProfile = Boolean(credentialProfileId) && !selectedProfile && profiles.length >= 0;
    const profileOptions = [
        INLINE_CREDENTIAL_PROFILE_VALUE,
        ...profiles.map((profile) => profile.id),
    ];
    if (missingProfile && credentialProfileId) {
        profileOptions.push(credentialProfileId);
    }
    const profileLabels: Record<string, string> = {
        [INLINE_CREDENTIAL_PROFILE_VALUE]: t('newConnection.inlineCredentials'),
        ...Object.fromEntries(
            profiles.map((profile) => [profile.id, `${profile.name} (${profile.username})`]),
        ),
    };
    if (missingProfile && credentialProfileId) {
        profileLabels[credentialProfileId] = t('newConnection.missingCredentialProfile', {
            id: credentialProfileId,
        });
    }

    const handleSelect = (value: string) => {
        if (value === INLINE_CREDENTIAL_PROFILE_VALUE) {
            onCredentialProfileChange(applySelectedCredentialProfile(undefined));
            return;
        }
        const profile = findCredentialProfile(profiles, value);
        if (!profile) {
            return;
        }
        onCredentialProfileChange(applySelectedCredentialProfile(profile));
    };

    const handleSaveAsProfile = async () => {
        if (useIamAuth) {
            setSaveAsStatus('error');
            setSaveAsMessage(t('newConnection.saveAsProfileIamUnsupported'));
            return;
        }
        const validation = validateCredentialProfileForm(
            {name: saveAsName, username, password},
            {requirePassword: true},
        );
        if (!validation.isValid) {
            setSaveAsStatus('error');
            setSaveAsMessage(t(validation.errorKey!));
            return;
        }
        try {
            const created = await createCredentialProfile(saveAsName, username, password, client);
            await onProfilesRefresh();
            onCredentialProfileChange(applySelectedCredentialProfile(created));
            setSaveAsOpen(false);
            setSaveAsName('');
            setSaveAsStatus('idle');
            setSaveAsMessage('');
        } catch (error) {
            setSaveAsStatus('error');
            setSaveAsMessage(
                t('newConnection.saveAsProfileFailed', {error: toErrorMessage(error)}),
            );
        }
    };

    const canSaveAsProfile =
        !credentialProfileId &&
        !useIamAuth &&
        username.trim().length > 0 &&
        password.trim().length > 0 &&
        !disabled;

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-1">
                <label className={LabelClass}>{t('newConnection.credentialProfile')}</label>
                <Select
                    ariaLabel={t('newConnection.selectCredentialProfile')}
                    value={credentialProfileId ?? INLINE_CREDENTIAL_PROFILE_VALUE}
                    options={profileOptions}
                    labels={profileLabels}
                    onChange={handleSelect}
                    placeholder={t('newConnection.selectCredentialProfile')}
                    searchable={profiles.length > 8}
                    disabled={disabled}
                />
                {missingProfile && (
                    <p className="text-xs text-accent-warning" role="status">
                        {t('newConnection.missingCredentialProfileHint')}
                    </p>
                )}
                {selectedProfile && (
                    <p className="text-xs text-muted">
                        {t('newConnection.credentialProfilePasswordHint')}
                    </p>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={onManageProfiles}
                    className="flex items-center gap-1.5 text-xs text-accent font-medium transition-colors"
                    disabled={disabled}
                >
                    <Settings size={12} />
                    {t('newConnection.manageCredentialProfiles')}
                </button>
                {canSaveAsProfile && !saveAsOpen && (
                    <button
                        type="button"
                        onClick={() => {
                            setSaveAsOpen(true);
                            setSaveAsStatus('idle');
                            setSaveAsMessage('');
                            setSaveAsName('');
                        }}
                        className="text-xs text-accent font-medium transition-colors"
                    >
                        {t('newConnection.saveAsCredentialProfile')}
                    </button>
                )}
            </div>

            {saveAsOpen && (
                <div className="rounded-lg border border-default bg-elevated p-3 space-y-3">
                    <p className="text-sm font-medium text-primary">
                        {t('newConnection.saveAsCredentialProfile')}
                    </p>
                    <input
                        type="text"
                        value={saveAsName}
                        onChange={(event) => setSaveAsName(event.target.value)}
                        placeholder={t('credentialProfiles.namePlaceholder')}
                        className="w-full px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted focus:border-focus focus:outline-none"
                        autoComplete="off"
                    />
                    {saveAsStatus === 'error' && saveAsMessage && (
                        <p className="text-xs text-accent-error" role="alert">
                            {saveAsMessage}
                        </p>
                    )}
                    <div className="flex gap-2 justify-end">
                        <button
                            type="button"
                            aria-label={t('newConnection.saveAsCredentialProfileCancel')}
                            onClick={() => {
                                setSaveAsOpen(false);
                                setSaveAsStatus('idle');
                                setSaveAsMessage('');
                            }}
                            className="px-3 py-1.5 text-xs border border-strong rounded-md text-secondary hover:bg-surface-secondary transition-colors"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleSaveAsProfile()}
                            className={clsx(
                                'px-3 py-1.5 text-xs rounded-md text-inverse transition-colors',
                                'bg-accent-primary hover:bg-accent-primary/90',
                            )}
                        >
                            {t('newConnection.saveAsCredentialProfileConfirm')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
