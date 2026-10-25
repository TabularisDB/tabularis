import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Plus, Edit2, Trash2, Check, Eye, EyeOff, X} from 'lucide-react';
import clsx from 'clsx';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {ConfirmModal} from '@/components/modals/ConfirmModal';
import {
    createCredentialProfile,
    deleteCredentialProfile,
    getCredentialProfileDependents,
    loadCredentialProfiles,
    updateCredentialProfile,
    validateCredentialProfileForm,
    type CredentialProfile,
    type CredentialProfileDependentConnection,
} from '@/utils/credentialProfiles';
import {parseCredentialProfileDeleteBlockedError} from '@/utils/credentialProfileErrors';
import {toErrorMessage} from '@/utils/errors';

const InputClass =
    'w-full px-3 pt-2 pb-1 bg-base border border-strong rounded-lg text-primary focus:border-focus focus:outline-none leading-tight';
const LabelClass = 'block text-xs uppercase font-bold text-muted';

interface ProfileFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
    placeholder?: string;
    autoFocus?: boolean;
    describedBy?: string;
}

function ProfileField({
    id,
    label,
    value,
    onChange,
    type = 'text',
    placeholder,
    autoFocus,
    describedBy,
}: ProfileFieldProps) {
    const {t} = useTranslation();
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === 'password';

    return (
        <div className="flex flex-col">
            <label className={LabelClass} htmlFor={id}>
                {label}
            </label>
            <div className="relative group">
                <input
                    id={id}
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={describedBy}
                    type={isPassword ? (showPassword ? 'text' : 'password') : type}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className={clsx(InputClass, isPassword && 'pr-10')}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-primary transition-colors focus:outline-none"
                        tabIndex={-1}
                        aria-label={
                            showPassword ? t('common.hidePassword') : t('common.showPassword')
                        }
                    >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                )}
            </div>
        </div>
    );
}

interface CredentialProfilesManagerProps {
    confirmOverlayClassName?: string;
    onProfilesChanged?: () => void;
}

export function CredentialProfilesManager({
    confirmOverlayClassName,
    onProfilesChanged,
}: CredentialProfilesManagerProps) {
    const client = useTabularisClient();
    const {t} = useTranslation();
    const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [status, setStatus] = useState<'idle' | 'error'>('idle');
    const [statusMessage, setStatusMessage] = useState('');
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
    const [deleteDependents, setDeleteDependents] = useState<
        CredentialProfileDependentConnection[] | null
    >(null);
    const [deleteLookupFailed, setDeleteLookupFailed] = useState(false);
    const [isCheckingDependents, setIsCheckingDependents] = useState(false);
    const deleteRequestRef = useRef(0);
    const nameInputId = useId();
    const usernameInputId = useId();
    const passwordInputId = useId();

    const refresh = useCallback(async () => {
        const result = await loadCredentialProfiles(client);
        setProfiles(result);
        onProfilesChanged?.();
    }, [client, onProfilesChanged]);

    useEffect(() => {
        let cancelled = false;
        void loadCredentialProfiles(client).then((result) => {
            if (!cancelled) {
                setProfiles(result);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [client]);

    const resetForm = () => {
        setName('');
        setUsername('');
        setPassword('');
        setEditingId(null);
        setIsCreating(false);
        setStatus('idle');
        setStatusMessage('');
    };

    const handleEdit = (profile: CredentialProfile) => {
        setName(profile.name);
        setUsername(profile.username);
        setPassword('');
        setEditingId(profile.id);
        setIsCreating(true);
        setStatus('idle');
        setStatusMessage('');
    };

    const handleSave = async () => {
        const validation = validateCredentialProfileForm(
            {name, username, password},
            {requirePassword: !editingId},
        );
        if (!validation.isValid) {
            setStatus('error');
            setStatusMessage(t(validation.errorKey!));
            return;
        }

        try {
            if (editingId) {
                await updateCredentialProfile(
                    editingId,
                    name,
                    username,
                    password.trim() ? password : undefined,
                    client,
                );
            } else {
                await createCredentialProfile(name, username, password, client);
            }
            await refresh();
            resetForm();
        } catch (error) {
            setStatus('error');
            setStatusMessage(t('credentialProfiles.failSave', {error: toErrorMessage(error)}));
        }
    };

    const closeDelete = useCallback(() => {
        deleteRequestRef.current += 1;
        setDeleteTargetId(null);
        setDeleteDependents(null);
        setDeleteLookupFailed(false);
        setIsCheckingDependents(false);
    }, []);

    // Resolve dependents before the destructive action so the confirmation can
    // name the connections the profile is shared with and refuse to orphan them.
    const openDelete = useCallback(
        async (id: string) => {
            const request = deleteRequestRef.current + 1;
            deleteRequestRef.current = request;
            setDeleteTargetId(id);
            setDeleteDependents(null);
            setDeleteLookupFailed(false);
            setIsCheckingDependents(true);
            try {
                const dependents = await getCredentialProfileDependents(id, client);
                if (deleteRequestRef.current !== request) return;
                setDeleteDependents(dependents);
            } catch {
                if (deleteRequestRef.current !== request) return;
                setDeleteLookupFailed(true);
            } finally {
                if (deleteRequestRef.current === request) {
                    setIsCheckingDependents(false);
                }
            }
        },
        [client],
    );

    const handleDelete = async (id: string) => {
        closeDelete();
        try {
            await deleteCredentialProfile(id, client);
            await refresh();
            setStatus('idle');
            setStatusMessage('');
        } catch (error) {
            // The lookup ran on open; a connection linked in the meantime still
            // trips the backend guard, which returns the same blocked payload.
            const blocked = parseCredentialProfileDeleteBlockedError(error);
            if (blocked) {
                const names = blocked.connections.map((connection) => connection.name).join(', ');
                setStatus('error');
                setStatusMessage(
                    t('credentialProfiles.deleteBlocked', {
                        count: blocked.connections.length,
                        names,
                    }),
                );
                return;
            }
            setStatus('error');
            setStatusMessage(t('credentialProfiles.failDelete', {error: toErrorMessage(error)}));
        }
    };

    const dependents = deleteDependents ?? [];
    const deleteBlocked = dependents.length > 0;

    return (
        <>
            {!isCreating ? (
                <>
                    <div className="mb-4">
                        <button
                            type="button"
                            onClick={() => {
                                resetForm();
                                setIsCreating(true);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors"
                        >
                            <Plus size={16} />
                            {t('credentialProfiles.createNew')}
                        </button>
                    </div>

                    {status === 'error' && statusMessage && (
                        <div
                            role="alert"
                            className="mb-4 p-3 rounded-lg flex items-start gap-2 text-sm border bg-accent-error/10 text-accent-error border-accent-error/25"
                        >
                            <X size={16} className="mt-0.5 shrink-0" />
                            <span>{statusMessage}</span>
                        </div>
                    )}

                    <div className="space-y-2">
                        {profiles.length === 0 ? (
                            <div className="text-center py-8 text-sm text-muted">
                                {t('credentialProfiles.noProfiles')}
                            </div>
                        ) : (
                            profiles.map((profile) => (
                                <div
                                    key={profile.id}
                                    className="flex items-center justify-between p-3 bg-elevated border border-default rounded-lg hover:border-accent-primary/60 transition-colors"
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-primary truncate">
                                            {profile.name}
                                        </div>
                                        <div className="text-xs text-muted truncate">
                                            {t('credentialProfiles.usernameLabel', {
                                                username: profile.username,
                                            })}
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => handleEdit(profile)}
                                            className="p-2 text-accent hover:bg-accent-primary/10 rounded-lg transition-colors"
                                            title={t('credentialProfiles.edit')}
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void openDelete(profile.id)}
                                            className="p-2 text-accent-error hover:bg-accent-error/10 rounded-lg transition-colors"
                                            title={t('credentialProfiles.delete')}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            ) : (
                <div className="space-y-4">
                    <ProfileField
                        id={nameInputId}
                        label={t('credentialProfiles.name')}
                        value={name}
                        onChange={setName}
                        placeholder={t('credentialProfiles.namePlaceholder')}
                        autoFocus
                    />
                    <ProfileField
                        id={usernameInputId}
                        label={t('credentialProfiles.username')}
                        value={username}
                        onChange={setUsername}
                        placeholder={t('credentialProfiles.usernamePlaceholder')}
                    />
                    <ProfileField
                        id={passwordInputId}
                        label={
                            editingId
                                ? t('credentialProfiles.rotatePassword')
                                : t('credentialProfiles.password')
                        }
                        value={password}
                        onChange={setPassword}
                        type="password"
                        placeholder={
                            editingId
                                ? t('credentialProfiles.rotatePasswordPlaceholder')
                                : t('credentialProfiles.passwordPlaceholder')
                        }
                        describedBy={editingId ? 'credential-profile-rotate-hint' : undefined}
                    />
                    {editingId && (
                        <p id="credential-profile-rotate-hint" className="text-xs text-muted">
                            {t('credentialProfiles.rotatePasswordHint')}
                        </p>
                    )}

                    {status === 'error' && statusMessage && (
                        <div
                            role="alert"
                            className="p-3 rounded-lg flex items-start gap-2 text-sm border bg-accent-error/10 text-accent-error border-accent-error/25"
                        >
                            <X size={16} className="mt-0.5 shrink-0" />
                            <span>{statusMessage}</span>
                        </div>
                    )}

                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={resetForm}
                            className="flex-1 px-4 py-2 border border-strong rounded-lg hover:bg-elevated transition-colors text-secondary text-sm font-medium"
                        >
                            {t('credentialProfiles.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleSave()}
                            className="flex-1 px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <Check size={16} />
                            {editingId
                                ? t('credentialProfiles.update')
                                : t('credentialProfiles.save')}
                        </button>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={deleteTargetId !== null}
                onClose={closeDelete}
                title={t('credentialProfiles.delete')}
                message={
                    deleteBlocked
                        ? t('credentialProfiles.deleteBlockedCount', {count: dependents.length})
                        : t('credentialProfiles.confirmDelete')
                }
                confirmDisabled={isCheckingDependents || deleteBlocked || deleteLookupFailed}
                onConfirm={() => deleteTargetId && void handleDelete(deleteTargetId)}
                overlayClassName={confirmOverlayClassName}
            >
                {deleteBlocked && (
                    <>
                        <ul className="space-y-1 text-sm text-secondary">
                            {dependents.map((connection) => (
                                <li key={connection.id} className="truncate">
                                    {connection.name}
                                </li>
                            ))}
                        </ul>
                        <p className="text-xs text-muted">
                            {t('credentialProfiles.deleteBlockedHint')}
                        </p>
                    </>
                )}
                {deleteLookupFailed && (
                    <p role="alert" className="text-xs text-accent-error">
                        {t('credentialProfiles.deleteDependentsError')}
                    </p>
                )}
            </ConfirmModal>
        </>
    );
}
