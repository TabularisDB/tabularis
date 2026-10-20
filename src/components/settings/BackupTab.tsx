import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {invoke} from '@tauri-apps/api/core';
import {open} from '@tauri-apps/plugin-dialog';
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    Database,
    FolderOpen,
    Info,
    Loader2,
    Pencil,
    Save,
    Square,
    CheckSquare,
    StopCircle,
} from 'lucide-react';
import {useSettings} from '../../hooks/useSettings';
import {useAlert} from '../../hooks/useAlert';
import {DEFAULT_SETTINGS} from '../../contexts/SettingsContext';
import {toErrorMessage} from '../../utils/errors';
import {PasswordInput} from '../ui/PasswordInput';
import {
    SettingSection,
    SettingRow,
    SettingButtonGroup,
    SettingNumberInput,
    SettingToggle,
} from './SettingControls';
import type {SavedConnection} from '../../contexts/DatabaseContext';
import type {PluginManifest} from '../../types/plugins';
import type {DatabaseBackupPlan, DatabaseBackupStatus} from '../../types/databaseBackup';
import {
    COMMON_IANA_TIMEZONES,
    isDriverDumpCapable,
    validateDatabaseBackupPlan,
} from '../../utils/databaseBackup';

interface BackupStatus {
    passwordSet: boolean;
    targetPasswordSet: boolean;
    lastBackupAt: string | null;
}

const INTERVAL_PRESETS = [360, 720, 1440, 10080];

const textInputClass =
    'w-64 px-3 py-2 bg-base border border-strong rounded-lg text-sm text-primary placeholder:text-muted focus:border-focus focus:outline-none transition-colors';

const DEFAULT_PLAN: DatabaseBackupPlan = {
    enabled: false,
    connectionId: '',
    database: '',
    schema: '',
    time: '02:00',
    timezone: 'local',
    destinationDirectory: '',
    retention: 7,
    includeStructure: true,
    includeData: true,
};

export function BackupTab() {
    const {t} = useTranslation();
    const {settings, updateSetting} = useSettings();
    const {showAlert} = useAlert();

    // ---------- Connection profiles backup state ----------
    const [status, setStatus] = useState<BackupStatus | null>(null);
    const [password, setPassword] = useState('');
    const [webdavPassword, setWebdavPassword] = useState('');
    const [webdavUrl, setWebdavUrl] = useState(settings.backupWebdavUrl ?? '');
    const [webdavUsername, setWebdavUsername] = useState(settings.backupWebdavUsername ?? '');
    const [savingPassword, setSavingPassword] = useState(false);
    const [savingWebdav, setSavingWebdav] = useState(false);
    const [editingPassword, setEditingPassword] = useState(false);
    const [editingWebdavPassword, setEditingWebdavPassword] = useState(false);
    const [runningBackup, setRunningBackup] = useState(false);
    const target = settings.backupTarget ?? 'local';
    const interval = settings.backupIntervalMinutes ?? 1440;
    const [customInterval, setCustomInterval] = useState(
        () => !INTERVAL_PRESETS.includes(interval),
    );
    const nextBackupAt =
        (settings.backupMode ?? 'manual') === 'interval' && status?.lastBackupAt
            ? new Date(new Date(status.lastBackupAt).getTime() + interval * 60_000)
            : null;

    // ---------- Database content backup state (Milestone 1) ----------
    const [connections, setConnections] = useState<SavedConnection[]>([]);
    const [driverManifests, setDriverManifests] = useState<PluginManifest[]>([]);
    const [dbStatus, setDbStatus] = useState<DatabaseBackupStatus | null>(null);
    const [runningDbBackup, setRunningDbBackup] = useState(false);
    const [cancellingDbBackup, setCancellingDbBackup] = useState(false);

    const plan: DatabaseBackupPlan = useMemo(
        () => ({
            ...DEFAULT_PLAN,
            ...(settings.databaseBackupPlan ?? {}),
        }),
        [settings.databaseBackupPlan],
    );

    // In-progress edits of the free-text fields; `null` shows the saved value.
    const [databaseDraft, setDatabaseDraft] = useState<string | null>(null);
    const [schemaDraft, setSchemaDraft] = useState<string | null>(null);

    const refreshStatus = useCallback(async () => {
        try {
            setStatus(await invoke<BackupStatus>('get_connections_backup_status'));
        } catch (e) {
            console.error('Failed to load connection backup status:', e);
        }
    }, []);

    const refreshDbStatus = useCallback(async () => {
        try {
            setDbStatus(await invoke<DatabaseBackupStatus>('get_database_backup_status'));
        } catch (e) {
            console.error('Failed to load database backup status:', e);
        }
    }, []);

    const updatePlan = useCallback(
        async (partial: Partial<DatabaseBackupPlan>) => {
            const updated: DatabaseBackupPlan = {...plan, ...partial};
            await updateSetting('databaseBackupPlan', updated);
            // The backend computes the next run from the saved plan.
            void refreshDbStatus();
        },
        [plan, updateSetting, refreshDbStatus],
    );

    const loadConnectionsAndDrivers = useCallback(async () => {
        try {
            const [conns, drivers] = await Promise.all([
                invoke<SavedConnection[]>('get_connections'),
                invoke<PluginManifest[]>('get_registered_drivers').catch(() => []),
            ]);
            setConnections(conns);
            setDriverManifests(drivers);
        } catch (e) {
            console.error('Failed to load connections or drivers:', e);
        }
    }, []);

    useEffect(() => {
        void refreshStatus();
    }, [refreshStatus, target]);

    useEffect(() => {
        void refreshDbStatus();
        void loadConnectionsAndDrivers();
    }, [refreshDbStatus, loadConnectionsAndDrivers]);

    // Selected connection capability check
    const selectedConnection = useMemo(
        () => connections.find((c) => c.id === plan.connectionId),
        [connections, plan.connectionId],
    );

    const selectedManifest = useMemo(
        () => driverManifests.find((m) => m.id === selectedConnection?.params.driver),
        [driverManifests, selectedConnection?.params.driver],
    );

    // `null` when the connection's driver is not registered (e.g. a removed
    // plugin), which is reported as not dump-capable.
    const selectedDriver = selectedConnection ? (selectedManifest ?? null) : undefined;

    const driverCapability = useMemo(
        () =>
            selectedDriver === undefined ? {capable: true} : isDriverDumpCapable(selectedDriver),
        [selectedDriver],
    );

    const planValidation = useMemo(
        () => validateDatabaseBackupPlan(plan, selectedDriver),
        [plan, selectedDriver],
    );

    const driverReason = driverCapability.reasonKey
        ? t(driverCapability.reasonKey, {
              driver: selectedConnection?.params.driver,
          })
        : t('settings.backup.dbBackupUnsupportedDriverNotice', {
              driver: selectedConnection?.params.driver,
          });

    // Shown in the plan's timezone so it matches the label next to it.
    const nextRunLabel = useMemo(() => {
        if (!plan.enabled || !dbStatus?.nextRunAt) return null;
        const timeZone = plan.timezone && plan.timezone !== 'local' ? plan.timezone : undefined;
        try {
            return new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone,
            }).format(new Date(dbStatus.nextRunAt));
        } catch {
            // Unknown IANA zone: the backend falls back to local time as well.
            return new Date(dbStatus.nextRunAt).toLocaleString();
        }
    }, [plan.enabled, plan.timezone, dbStatus?.nextRunAt]);

    const handlePickDirectory = async () => {
        const selected = await open({multiple: false, directory: true});
        if (typeof selected === 'string') {
            await updateSetting('backupDirectory', selected);
            void refreshStatus();
        }
    };

    const handlePickDbDirectory = async () => {
        const selected = await open({multiple: false, directory: true});
        if (typeof selected === 'string') {
            await updatePlan({destinationDirectory: selected});
            void refreshDbStatus();
        }
    };

    const handleSavePassword = async () => {
        setSavingPassword(true);
        try {
            await invoke('set_connections_backup_password', {password});
            setPassword('');
            setEditingPassword(false);
            await refreshStatus();
            showAlert(t('settings.backup.passwordSaved'));
        } catch (e) {
            showAlert(toErrorMessage(e));
        } finally {
            setSavingPassword(false);
        }
    };

    const handleSaveWebdavPassword = async () => {
        if (!webdavPassword) return;
        setSavingWebdav(true);
        try {
            await invoke('set_connections_backup_target_password', {
                targetId: 'webdav',
                password: webdavPassword,
            });
            setWebdavPassword('');
            setEditingWebdavPassword(false);
            await refreshStatus();
            showAlert(t('settings.backup.webdavSaved'));
        } catch (e) {
            showAlert(toErrorMessage(e));
        } finally {
            setSavingWebdav(false);
        }
    };

    const handleBackupNow = async () => {
        setRunningBackup(true);
        try {
            const path = await invoke<string>('run_connections_backup');
            await refreshStatus();
            showAlert(t('settings.backup.backupDone', {path}));
        } catch (e) {
            showAlert(toErrorMessage(e));
        } finally {
            setRunningBackup(false);
        }
    };

    const handleRunDatabaseBackupNow = async () => {
        if (!planValidation.isValid && planValidation.errorKey) {
            showAlert(t(planValidation.errorKey), {kind: 'error'});
            return;
        }
        setRunningDbBackup(true);
        try {
            const path = await invoke<string>('run_database_backup_now');
            await refreshDbStatus();
            showAlert(t('settings.backup.dbBackupDone', {path}));
        } catch (e) {
            showAlert(toErrorMessage(e), {kind: 'error'});
            await refreshDbStatus();
        } finally {
            setRunningDbBackup(false);
        }
    };

    const handleCancelDatabaseBackup = async () => {
        if (!plan.connectionId) return;
        setCancellingDbBackup(true);
        try {
            await invoke('cancel_database_backup', {
                connectionId: plan.connectionId,
            });
            await refreshDbStatus();
            showAlert(t('settings.backup.dbBackupCancelled'));
        } catch (e) {
            showAlert(toErrorMessage(e));
        } finally {
            setCancellingDbBackup(false);
        }
    };

    const configured =
        status?.passwordSet === true &&
        (target === 'webdav'
            ? Boolean(settings.backupWebdavUrl) && status?.targetPasswordSet === true
            : Boolean(settings.backupDirectory));

    const isDbBackupActive = dbStatus?.isRunning || runningDbBackup;

    return (
        <div>
            {/* ───────────────────────────────────────────────────────────────── */}
            {/* Section 1: Connection Profiles Backup                             */}
            {/* ───────────────────────────────────────────────────────────────── */}
            <SettingSection
                title={t('settings.backup.connectionProfilesSection')}
                description={t('settings.backup.connectionProfilesDesc')}
            >
                <SettingRow
                    label={t('settings.backup.target')}
                    description={t('settings.backup.targetDesc')}
                >
                    <SettingButtonGroup<'local' | 'webdav'>
                        value={target}
                        onChange={(v) => {
                            void updateSetting('backupTarget', v);
                            void refreshStatus();
                        }}
                        options={[
                            {value: 'local', label: t('settings.backup.targetLocal')},
                            {value: 'webdav', label: 'WebDAV'},
                        ]}
                    />
                </SettingRow>

                {target === 'local' && (
                    <SettingRow
                        label={t('settings.backup.directory')}
                        description={settings.backupDirectory || t('settings.backup.directoryDesc')}
                    >
                        <button
                            onClick={() => void handlePickDirectory()}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-accent hover:border-accent-primary/50 transition-colors"
                        >
                            <FolderOpen size={14} />
                            {t('settings.backup.chooseDirectory')}
                        </button>
                    </SettingRow>
                )}

                {target === 'webdav' && (
                    <>
                        <SettingRow
                            label={t('settings.backup.webdavUrl')}
                            description={t('settings.backup.webdavUrlDesc')}
                        >
                            <input
                                autoComplete="off"
                                type="url"
                                value={webdavUrl}
                                onChange={(e) => setWebdavUrl(e.target.value)}
                                onBlur={() =>
                                    void updateSetting('backupWebdavUrl', webdavUrl.trim())
                                }
                                placeholder="https://cloud.example.com/remote.php/dav/files/user/backups"
                                spellCheck={false}
                                autoCorrect="off"
                                autoCapitalize="off"
                                aria-label={t('settings.backup.webdavUrl')}
                                className={textInputClass}
                            />
                        </SettingRow>
                        <SettingRow
                            label={t('settings.backup.webdavUsername')}
                            description={t('settings.backup.webdavUsernameDesc')}
                        >
                            <input
                                autoComplete="off"
                                type="text"
                                value={webdavUsername}
                                onChange={(e) => setWebdavUsername(e.target.value)}
                                onBlur={() =>
                                    void updateSetting(
                                        'backupWebdavUsername',
                                        webdavUsername.trim(),
                                    )
                                }
                                spellCheck={false}
                                autoCorrect="off"
                                autoCapitalize="off"
                                aria-label={t('settings.backup.webdavUsername')}
                                className={textInputClass}
                            />
                        </SettingRow>
                        <SettingRow
                            label={t('settings.backup.webdavPassword')}
                            description={
                                status?.targetPasswordSet && !editingWebdavPassword
                                    ? t('settings.backup.webdavPasswordSetDesc')
                                    : t('settings.backup.webdavPasswordDesc')
                            }
                        >
                            {status?.targetPasswordSet && !editingWebdavPassword ? (
                                <div className="flex items-center gap-2">
                                    <span
                                        aria-hidden="true"
                                        className="px-3 py-2 text-sm text-muted tracking-widest select-none"
                                    >
                                        ••••••••
                                    </span>
                                    <button
                                        onClick={() => setEditingWebdavPassword(true)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-accent hover:border-accent-primary/50 transition-colors"
                                    >
                                        <Pencil size={14} />
                                        {t('settings.backup.changePassword')}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <div className="w-48">
                                        <PasswordInput
                                            value={webdavPassword}
                                            onChange={setWebdavPassword}
                                            autoFocus={editingWebdavPassword}
                                            aria-label={t('settings.backup.webdavPassword')}
                                        />
                                    </div>
                                    <button
                                        onClick={() => void handleSaveWebdavPassword()}
                                        disabled={savingWebdav || !webdavPassword}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-50 text-inverse text-sm transition-colors"
                                    >
                                        {savingWebdav ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Save size={14} />
                                        )}
                                        {t('common.save')}
                                    </button>
                                    {editingWebdavPassword && (
                                        <button
                                            onClick={() => {
                                                setWebdavPassword('');
                                                setEditingWebdavPassword(false);
                                            }}
                                            className="px-3 py-1.5 rounded-lg text-sm text-secondary hover:text-primary transition-colors"
                                        >
                                            {t('common.cancel')}
                                        </button>
                                    )}
                                </div>
                            )}
                        </SettingRow>
                    </>
                )}

                <SettingRow
                    label={t('settings.backup.mode')}
                    description={t('settings.backup.modeDesc')}
                >
                    <SettingButtonGroup<'manual' | 'interval' | 'onClose' | 'onLaunch'>
                        value={settings.backupMode ?? 'manual'}
                        onChange={(v) => {
                            if (v !== 'manual' && !configured) {
                                showAlert(t('settings.backup.configureFirst'));
                                return;
                            }
                            void updateSetting('backupMode', v);
                        }}
                        options={[
                            {value: 'manual', label: t('settings.backup.modeManual')},
                            {value: 'interval', label: t('settings.backup.modeInterval')},
                            {value: 'onClose', label: t('settings.backup.modeOnClose')},
                            {value: 'onLaunch', label: t('settings.backup.modeOnLaunch')},
                        ]}
                    />
                </SettingRow>

                <SettingRow
                    label={t('settings.backup.password')}
                    description={
                        status?.passwordSet
                            ? editingPassword
                                ? t('settings.backup.passwordReplaceDesc')
                                : t('settings.backup.passwordSetDesc')
                            : t('settings.backup.passwordDesc')
                    }
                >
                    {status?.passwordSet && !editingPassword ? (
                        <div className="flex items-center gap-2">
                            <span
                                aria-hidden="true"
                                className="px-3 py-2 text-sm text-muted tracking-widest select-none"
                            >
                                ••••••••
                            </span>
                            <button
                                onClick={() => setEditingPassword(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-accent hover:border-accent-primary/50 transition-colors"
                            >
                                <Pencil size={14} />
                                {t('settings.backup.changePassword')}
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <div className="w-48">
                                <PasswordInput
                                    value={password}
                                    onChange={setPassword}
                                    autoFocus={editingPassword}
                                    aria-label={t('settings.backup.password')}
                                />
                            </div>
                            <button
                                onClick={() => void handleSavePassword()}
                                disabled={savingPassword || !password}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-50 text-inverse text-sm transition-colors"
                            >
                                {savingPassword ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <Save size={14} />
                                )}
                                {t('common.save')}
                            </button>
                            {editingPassword && (
                                <button
                                    onClick={() => {
                                        setPassword('');
                                        setEditingPassword(false);
                                    }}
                                    className="px-3 py-1.5 rounded-lg text-sm text-secondary hover:text-primary transition-colors"
                                >
                                    {t('common.cancel')}
                                </button>
                            )}
                        </div>
                    )}
                </SettingRow>

                {(settings.backupMode ?? 'manual') === 'interval' && (
                    <SettingRow
                        label={t('settings.backup.interval')}
                        description={t('settings.backup.intervalDesc')}
                    >
                        <div className="flex items-center gap-2">
                            <SettingButtonGroup<number>
                                value={customInterval ? -1 : interval}
                                onChange={(v) => {
                                    if (v === -1) {
                                        setCustomInterval(true);
                                        return;
                                    }
                                    setCustomInterval(false);
                                    void updateSetting('backupIntervalMinutes', v);
                                }}
                                options={[
                                    {value: 360, label: t('settings.backup.every6h')},
                                    {value: 720, label: t('settings.backup.every12h')},
                                    {value: 1440, label: t('settings.backup.daily')},
                                    {value: 10080, label: t('settings.backup.weekly')},
                                    {value: -1, label: t('settings.backup.custom')},
                                ]}
                            />
                            {customInterval && (
                                <SettingNumberInput
                                    value={Math.max(1, Math.round(interval / 60))}
                                    onChange={(v) =>
                                        updateSetting('backupIntervalMinutes', (v || 24) * 60)
                                    }
                                    min={1}
                                    max={720}
                                    suffix={t('settings.backup.hours')}
                                    fallback={24}
                                />
                            )}
                        </div>
                    </SettingRow>
                )}

                <SettingRow
                    label={t('settings.backup.retention')}
                    description={t('settings.backup.retentionDesc')}
                >
                    <SettingNumberInput
                        value={settings.backupRetention ?? DEFAULT_SETTINGS.backupRetention ?? 10}
                        onChange={(v) =>
                            updateSetting(
                                'backupRetention',
                                v || DEFAULT_SETTINGS.backupRetention || 10,
                            )
                        }
                        min={1}
                        max={100}
                        suffix={t('settings.backup.files')}
                        fallback={DEFAULT_SETTINGS.backupRetention ?? 10}
                    />
                </SettingRow>

                <SettingRow
                    label={t('settings.backup.backupNow')}
                    description={
                        (status?.lastBackupAt
                            ? t('settings.backup.lastBackup', {
                                  date: new Date(status.lastBackupAt).toLocaleString(),
                              })
                            : t('settings.backup.noBackupYet')) +
                        (nextBackupAt
                            ? ` — ${t('settings.backup.nextBackup', {
                                  date: nextBackupAt.toLocaleString(),
                              })}`
                            : (settings.backupMode ?? 'manual') === 'interval'
                              ? ` — ${t('settings.backup.nextBackupSoon')}`
                              : '')
                    }
                >
                    <button
                        onClick={() => void handleBackupNow()}
                        disabled={runningBackup || !configured}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-accent hover:border-accent-primary/50 disabled:opacity-50 transition-colors"
                    >
                        {runningBackup && <Loader2 size={14} className="animate-spin" />}
                        {t('settings.backup.backupNow')}
                    </button>
                </SettingRow>
            </SettingSection>

            {/* ───────────────────────────────────────────────────────────────── */}
            {/* Section 2: Scheduled Database Content Backups (Milestone 1)       */}
            {/* ───────────────────────────────────────────────────────────────── */}
            <SettingSection
                title={t('settings.backup.databaseContentSection')}
                description={t('settings.backup.databaseContentDesc')}
                icon={<Database size={16} className="text-accent" />}
            >
                {/* App-Open Execution Boundary Notification */}
                <div className="flex items-start gap-2.5 p-3 mb-4 rounded-lg bg-surface-secondary/40 border border-default text-xs text-secondary">
                    <Info size={16} className="text-accent shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium text-primary">
                            {t('settings.backup.databaseContentDesc')}
                        </p>
                        <p className="mt-0.5 text-muted">
                            {t('settings.backup.dbBackupAppOpenNotice')}
                        </p>
                    </div>
                </div>

                {/* Enable Plan Switch */}
                <SettingRow
                    label={t('settings.backup.dbBackupEnable')}
                    description={t('settings.backup.dbBackupEnableDesc')}
                >
                    <SettingToggle
                        checked={plan.enabled}
                        disabled={!driverCapability.capable && Boolean(plan.connectionId)}
                        onChange={(checked) => {
                            if (checked && !driverCapability.capable) {
                                showAlert(driverReason, {kind: 'error'});
                                return;
                            }
                            void updatePlan({enabled: checked});
                        }}
                    />
                </SettingRow>

                {/* Database Connection Selector */}
                <SettingRow
                    label={t('settings.backup.dbBackupConnection')}
                    description={t('settings.backup.dbBackupConnectionDesc')}
                >
                    <div className="flex flex-col items-end gap-1.5">
                        <select
                            value={plan.connectionId}
                            onChange={(e) => {
                                const connId = e.target.value;
                                const conn = connections.find((c) => c.id === connId);
                                const manifest = driverManifests.find(
                                    (m) => m.id === conn?.params.driver,
                                );
                                const cap = conn
                                    ? isDriverDumpCapable(manifest ?? null)
                                    : {capable: true};
                                void updatePlan({
                                    connectionId: connId,
                                    // If unsupported driver, automatically disable schedule
                                    enabled: cap.capable ? plan.enabled : false,
                                });
                            }}
                            aria-label={t('settings.backup.dbBackupConnection')}
                            className="w-64 px-3 py-2 bg-base border border-strong rounded-lg text-sm text-primary focus:border-focus focus:outline-none transition-colors"
                        >
                            <option value="">
                                {t('settings.backup.dbBackupSelectConnectionPlaceholder')}
                            </option>
                            {connections.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name} ({c.params.driver})
                                </option>
                            ))}
                        </select>

                        {/* Unsupported driver explanation banner */}
                        {!driverCapability.capable && (
                            <div className="flex items-center gap-1.5 p-2 rounded bg-accent-warning/10 border border-accent-warning/30 text-xs text-accent-warning max-w-sm">
                                <AlertCircle size={14} className="shrink-0" />
                                <span>{driverReason}</span>
                            </div>
                        )}
                    </div>
                </SettingRow>

                {/* Database / Catalog Name (optional for single-db connections) */}
                <SettingRow
                    label={t('settings.backup.dbBackupDatabase')}
                    description={t('settings.backup.dbBackupDatabaseDesc')}
                >
                    <input
                        autoComplete="off"
                        type="text"
                        value={databaseDraft ?? plan.database ?? ''}
                        onChange={(e) => setDatabaseDraft(e.target.value)}
                        onBlur={(e) => {
                            const trimmed = e.target.value.trim();
                            setDatabaseDraft(null);
                            if (trimmed !== (plan.database ?? '')) {
                                void updatePlan({database: trimmed || undefined});
                            }
                        }}
                        placeholder={t('settings.backup.dbBackupDatabasePlaceholder')}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        aria-label={t('settings.backup.dbBackupDatabase')}
                        className={textInputClass}
                    />
                </SettingRow>

                {/* Schema (optional for PostgreSQL / schema-capable engines) */}
                <SettingRow
                    label={t('settings.backup.dbBackupSchema')}
                    description={t('settings.backup.dbBackupSchemaDesc')}
                >
                    <input
                        autoComplete="off"
                        type="text"
                        value={schemaDraft ?? plan.schema ?? ''}
                        onChange={(e) => setSchemaDraft(e.target.value)}
                        onBlur={(e) => {
                            const trimmed = e.target.value.trim();
                            setSchemaDraft(null);
                            if (trimmed !== (plan.schema ?? '')) {
                                void updatePlan({schema: trimmed || undefined});
                            }
                        }}
                        placeholder={t('settings.backup.dbBackupSchemaPlaceholder')}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        aria-label={t('settings.backup.dbBackupSchema')}
                        className={textInputClass}
                    />
                </SettingRow>

                {/* Destination Directory */}
                <SettingRow
                    label={t('settings.backup.dbBackupDirectory')}
                    description={
                        plan.destinationDirectory || t('settings.backup.dbBackupDirectoryDesc')
                    }
                >
                    <button
                        onClick={() => void handlePickDbDirectory()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-accent hover:border-accent-primary/50 transition-colors"
                    >
                        <FolderOpen size={14} />
                        {t('settings.backup.chooseDirectory')}
                    </button>
                </SettingRow>

                {/* Daily Run Time (24h clock) */}
                <SettingRow
                    label={t('settings.backup.dbBackupTime')}
                    description={t('settings.backup.dbBackupTimeDesc')}
                >
                    <input
                        type="time"
                        value={plan.time || '02:00'}
                        onChange={(e) => void updatePlan({time: e.target.value})}
                        aria-label={t('settings.backup.dbBackupTime')}
                        className="w-40 px-3 py-2 bg-base border border-strong rounded-lg text-sm text-primary font-mono focus:border-focus focus:outline-none transition-colors"
                    />
                </SettingRow>

                {/* IANA Timezone Selection */}
                <SettingRow
                    label={t('settings.backup.dbBackupTimezone')}
                    description={t('settings.backup.dbBackupTimezoneDesc')}
                >
                    <select
                        value={plan.timezone || 'local'}
                        onChange={(e) => void updatePlan({timezone: e.target.value})}
                        aria-label={t('settings.backup.dbBackupTimezone')}
                        className="w-64 px-3 py-2 bg-base border border-strong rounded-lg text-sm text-primary focus:border-focus focus:outline-none transition-colors"
                    >
                        <option value="local">
                            {t('settings.backup.dbBackupTimezoneLocal')} (
                            {Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'})
                        </option>
                        {COMMON_IANA_TIMEZONES.map((tz) => (
                            <option key={tz} value={tz}>
                                {tz}
                            </option>
                        ))}
                    </select>
                </SettingRow>

                {/* Retention Limit */}
                <SettingRow
                    label={t('settings.backup.dbBackupRetention')}
                    description={t('settings.backup.dbBackupRetentionDesc')}
                >
                    <SettingNumberInput
                        value={plan.retention ?? 7}
                        onChange={(v) => void updatePlan({retention: Math.max(1, v)})}
                        min={1}
                        max={100}
                        suffix={t('settings.backup.files')}
                        fallback={7}
                    />
                </SettingRow>

                {/* Dump Content Options (Structure & Data) */}
                <SettingRow
                    label={t('settings.backup.dbBackupContent')}
                    description={t('settings.backup.dbBackupContentDesc')}
                >
                    <div className="flex items-center gap-6">
                        <button
                            type="button"
                            onClick={() =>
                                void updatePlan({
                                    includeStructure: !plan.includeStructure,
                                })
                            }
                            className="flex items-center gap-2 text-sm text-primary hover:text-accent transition-colors"
                        >
                            {plan.includeStructure ? (
                                <CheckSquare size={16} className="text-accent" />
                            ) : (
                                <Square size={16} className="text-muted" />
                            )}
                            <span>{t('settings.backup.dbBackupIncludeStructure')}</span>
                        </button>

                        <button
                            type="button"
                            onClick={() =>
                                void updatePlan({
                                    includeData: !plan.includeData,
                                })
                            }
                            className="flex items-center gap-2 text-sm text-primary hover:text-accent transition-colors"
                        >
                            {plan.includeData ? (
                                <CheckSquare size={16} className="text-accent" />
                            ) : (
                                <Square size={16} className="text-muted" />
                            )}
                            <span>{t('settings.backup.dbBackupIncludeData')}</span>
                        </button>
                    </div>
                </SettingRow>

                {/* Status Dashboard & Action Buttons */}
                <SettingRow
                    label={t('settings.backup.dbBackupStatus')}
                    description={
                        <span className="flex flex-col gap-1 text-xs">
                            {/* Outcome / Last Run */}
                            <span className="flex items-center gap-1.5">
                                <Clock size={13} className="text-muted shrink-0" />
                                <span>{t('settings.backup.dbBackupLastRun')}: </span>
                                {dbStatus?.lastRunAt ? (
                                    <span className="font-mono text-primary">
                                        {new Date(dbStatus.lastRunAt).toLocaleString()}
                                    </span>
                                ) : (
                                    <span className="text-muted">
                                        {t('settings.backup.dbBackupNeverRun')}
                                    </span>
                                )}
                                {dbStatus?.lastOutcome === 'success' && (
                                    <span className="inline-flex items-center gap-1 text-accent-success font-medium ml-1">
                                        <CheckCircle2 size={13} />
                                        {t('settings.backup.dbBackupOutcomeSuccess')}
                                    </span>
                                )}
                                {dbStatus?.lastOutcome === 'error' && (
                                    <span
                                        className="inline-flex items-center gap-1 text-accent-error font-medium ml-1"
                                        title={dbStatus.lastError ?? ''}
                                    >
                                        <AlertCircle size={13} />
                                        {t('settings.backup.dbBackupOutcomeFailed', {
                                            error: dbStatus.lastError ?? '',
                                        })}
                                    </span>
                                )}
                                {dbStatus?.lastOutcome === 'cancelled' && (
                                    <span className="inline-flex items-center gap-1 text-accent-warning font-medium ml-1">
                                        <StopCircle size={13} />
                                        {t('settings.backup.dbBackupOutcomeCancelled')}
                                    </span>
                                )}
                            </span>

                            {/* Next Scheduled Run */}
                            {nextRunLabel && (
                                <span className="flex items-center gap-1.5 text-muted">
                                    <span>{t('settings.backup.dbBackupNextRun')}: </span>
                                    <span className="font-mono text-primary">{nextRunLabel}</span>
                                    <span>({plan.timezone || 'local'})</span>
                                </span>
                            )}
                        </span>
                    }
                >
                    <div className="flex items-center gap-2">
                        {isDbBackupActive && (
                            <button
                                type="button"
                                onClick={() => void handleCancelDatabaseBackup()}
                                disabled={cancellingDbBackup}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-accent-error text-sm text-accent-error hover:bg-accent-error/10 transition-colors"
                            >
                                {cancellingDbBackup ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <StopCircle size={14} />
                                )}
                                {t('settings.backup.dbBackupCancel')}
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={() => void handleRunDatabaseBackupNow()}
                            disabled={
                                isDbBackupActive ||
                                !planValidation.isValid ||
                                !driverCapability.capable
                            }
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-50 text-inverse text-sm transition-colors shadow-sm"
                        >
                            {isDbBackupActive ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    {t('settings.backup.dbBackupStatusRunning')}
                                </>
                            ) : (
                                <>
                                    <Database size={14} />
                                    {t('settings.backup.dbBackupRunNow')}
                                </>
                            )}
                        </button>
                    </div>
                </SettingRow>
            </SettingSection>
        </div>
    );
}
