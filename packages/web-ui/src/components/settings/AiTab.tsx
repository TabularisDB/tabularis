import {useState, useEffect, useCallback, useId, useMemo} from 'react';
import {useTranslation, Trans} from 'react-i18next';
import {Link} from 'react-router-dom';
import {useAiProviders} from '@/hooks/useAiProviders';
import {
    CheckCircle2,
    Code2,
    RefreshCw,
    AlertTriangle,
    Lock,
    X,
    Info,
    ChevronDown,
    Eye,
    EyeOff,
    Sparkles,
    Network,
    SlidersHorizontal,
    Check,
} from 'lucide-react';
import clsx from 'clsx';
import {useSettings} from '@/hooks/useSettings';
import {useAlert} from '@/hooks/useAlert';
import type {AiProvider} from '@/contexts/SettingsContext';
import type {AiKeyStatus} from '@/types/ai';
import {getProviderLabel} from '@/utils/settingsUI';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {Select} from '@/components/ui/Select';
import {SettingSection, SettingRow, SettingToggle} from './SettingControls';
import {ProxyOverrideEditor} from './ProxyFields';
import {ChatGptSettings} from './ChatGptSettings';
import {
    defaultProxyOverride,
    normalizeProxyOverride,
    proxyKeychainAi,
    type ProxyOverride,
} from '@/types/proxy';
import {OpenAIIcon} from '@/components/icons/ClientIcons';

export function AiTab() {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const {settings, updateSetting} = useSettings();
    const {showAlert} = useAlert();
    const {
        providers,
        pendingMigration,
        error: providerError,
        loading: providersLoading,
        retryMigration,
    } = useAiProviders();
    const selectedProvider = providers.find((provider) => provider.id === settings.aiProvider);
    const requiresKey = selectedProvider?.ai_assistant.authentication === 'api-key';
    const providerChoices = useMemo(
        () => [
            ...(platform.negotiation.environment === 'tauri'
                ? [
                      {
                          id: 'chatgpt',
                          label: 'ChatGPT',
                          icon: <OpenAIIcon size={18} />,
                          authentication: 'account',
                      },
                  ]
                : []),
            ...providers.map((provider) => ({
                id: provider.id,
                label: provider.name,
                icon: <Sparkles size={18} />,
                authentication: provider.ai_assistant.authentication,
            })),
        ],
        [providers, platform.negotiation.environment],
    );
    const fieldId = useId();
    const [proxyDrafts, setProxyDrafts] = useState<Partial<Record<AiProvider, ProxyOverride>>>({});

    const [aiKeyStatus, setAiKeyStatus] = useState<Record<string, AiKeyStatus>>({});
    const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({});
    const [keyInput, setKeyInput] = useState('');
    const [editingKey, setEditingKey] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState('');
    const [explainPrompt, setExplainPrompt] = useState('');
    const [cellnamePrompt, setCellnamePrompt] = useState('');
    const [tabrenamePrompt, setTabrenamePrompt] = useState('');
    const [explainplanPrompt, setExplainplanPrompt] = useState('');
    const [promptSectionOpen, setPromptSectionOpen] = useState<
        'system' | 'explain' | 'cellname' | 'tabrename' | 'explainplan' | null
    >(null);

    const loadModels = useCallback(
        async (force: boolean = false) => {
            try {
                const models = await client.call('get_ai_models', {
                    forceRefresh: force,
                });
                setAvailableModels(models);
                if (force) {
                    showAlert(t('settings.ai.refreshSuccess'), {
                        title: t('common.success'),
                        kind: 'info',
                    });
                }
            } catch (e) {
                console.error('Failed to load AI models', e);
                showAlert(t('settings.ai.refreshError') + ': ' + String(e), {
                    title: t('common.error'),
                    kind: 'error',
                });
            }
        },
        [client, t, showAlert],
    );

    const checkKeys = useCallback(async () => {
        try {
            const statuses = await Promise.all(
                providers.map(
                    async (provider) =>
                        [
                            provider.id,
                            provider.ai_assistant.authentication === 'none'
                                ? {configured: true, fromEnv: false}
                                : await client.call('check_ai_key_status', {provider: provider.id}),
                        ] as const,
                ),
            );
            setAiKeyStatus(Object.fromEntries(statuses));
        } catch (e) {
            console.error('Failed to check keys', e);
        }
    }, [client, providers]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        checkKeys();
        loadModels(false);
        client.call('get_system_prompt', undefined).then(setSystemPrompt).catch(console.error);
        client.call('get_explain_prompt', undefined).then(setExplainPrompt).catch(console.error);
        client.call('get_cellname_prompt', undefined).then(setCellnamePrompt).catch(console.error);
        client
            .call('get_tabrename_prompt', undefined)
            .then(setTabrenamePrompt)
            .catch(console.error);
        client
            .call('get_explainplan_prompt', undefined)
            .then(setExplainplanPrompt)
            .catch(console.error);
    }, [checkKeys, client, loadModels]);

    const handleSaveKey = async (provider: string) => {
        if (!keyInput.trim()) return;
        try {
            await client.call('set_ai_key', {provider, key: keyInput});
            await checkKeys();
            setKeyInput('');
            setEditingKey(false);
            showAlert(t('settings.ai.apiKeySaved'), {
                title: t('common.success'),
                kind: 'info',
            });
        } catch (e) {
            showAlert(String(e), {title: t('common.error'), kind: 'error'});
        }
    };

    const handleSavePrompt = async (
        type: 'system' | 'explain' | 'cellname' | 'tabrename' | 'explainplan',
    ) => {
        const promptMap = {
            system: systemPrompt,
            explain: explainPrompt,
            cellname: cellnamePrompt,
            tabrename: tabrenamePrompt,
            explainplan: explainplanPrompt,
        };
        const prompt = promptMap[type];
        const savePrompt = {
            system: () => client.call('save_system_prompt', {prompt}),
            explain: () => client.call('save_explain_prompt', {prompt}),
            cellname: () => client.call('save_cellname_prompt', {prompt}),
            tabrename: () => client.call('save_tabrename_prompt', {prompt}),
            explainplan: () => client.call('save_explainplan_prompt', {prompt}),
        };
        try {
            await savePrompt[type]();
            showAlert(t('settings.ai.promptSaved'), {
                title: t('common.success'),
                kind: 'info',
            });
        } catch (e) {
            showAlert(String(e), {title: t('common.error'), kind: 'error'});
        }
    };

    const handleResetPrompt = async (
        type: 'system' | 'explain' | 'cellname' | 'tabrename' | 'explainplan',
    ) => {
        const setterMap = {
            system: setSystemPrompt,
            explain: setExplainPrompt,
            cellname: setCellnamePrompt,
            tabrename: setTabrenamePrompt,
            explainplan: setExplainplanPrompt,
        };
        const setter = setterMap[type];
        const resetPrompt = {
            system: () => client.call('reset_system_prompt', undefined),
            explain: () => client.call('reset_explain_prompt', undefined),
            cellname: () => client.call('reset_cellname_prompt', undefined),
            tabrename: () => client.call('reset_tabrename_prompt', undefined),
            explainplan: () => client.call('reset_explainplan_prompt', undefined),
        };
        try {
            const defaultPrompt = await resetPrompt[type]();
            setter(defaultPrompt);
            showAlert(t('settings.ai.promptResetSuccess'), {
                title: t('common.success'),
                kind: 'info',
            });
        } catch (e) {
            showAlert(String(e), {title: t('common.error'), kind: 'error'});
        }
    };

    return (
        <div className="@container">
            {/* Enable toggle */}
            <div className="mb-8 rounded-xl border border-default bg-elevated px-5 py-2">
                <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-primary/10 text-accent">
                        <Sparkles size={20} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <SettingRow
                            label={t('settings.ai.enable')}
                            description={t('settings.ai.enableDesc')}
                        >
                            <SettingToggle
                                checked={settings.aiEnabled ?? false}
                                onChange={(v) => updateSetting('aiEnabled', v)}
                            />
                        </SettingRow>
                    </div>
                </div>
            </div>

            <div className="mb-5 space-y-3">
                <Link
                    to="?tab=plugins&kind=ai-assistant"
                    className="inline-flex items-center gap-2 text-sm text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                    <Sparkles size={16} />
                    {t('settings.ai.manageProviders')}
                </Link>
                {providerError && (
                    <p role="alert" className="text-sm text-accent-error">
                        {providerError}
                    </p>
                )}
                {pendingMigration.length > 0 && (
                    <div
                        role="status"
                        className="rounded-lg border border-accent-warning bg-accent-warning/5 p-3 text-sm text-primary"
                    >
                        <p>
                            {t('settings.ai.pluginMigration', {
                                providers: pendingMigration.join(', '),
                            })}
                        </p>
                        <button
                            type="button"
                            disabled={providersLoading}
                            onClick={() => void retryMigration()}
                            className="mt-2 text-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                            {t('settings.ai.retryMigration')}
                        </button>
                    </div>
                )}
                {settings.aiProvider && settings.aiProvider !== 'chatgpt' && !selectedProvider && (
                    <p role="status" className="text-sm text-muted">
                        {t('settings.ai.providerMissing', {
                            provider: getProviderLabel(settings.aiProvider),
                        })}
                    </p>
                )}
            </div>

            <fieldset
                disabled={!settings.aiEnabled}
                className={clsx(
                    'min-w-0 transition-opacity',
                    !settings.aiEnabled && 'opacity-50 pointer-events-none',
                )}
            >
                {/* Provider selection */}
                <SettingSection
                    title={t('settings.ai.defaultProvider')}
                    description={t('settings.ai.providerHelp')}
                >
                    <div className="grid grid-cols-2 @min-[560px]:grid-cols-3 gap-2.5 pt-3">
                        {providerChoices.map((p) => {
                            const isSelected = settings.aiProvider === p.id;
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    aria-label={p.label}
                                    aria-pressed={isSelected}
                                    onClick={() => {
                                        if (!isSelected) {
                                            // Empty strings clear persisted optional fields; null means no change.
                                            void updateSetting('aiModel', '');
                                        }
                                        updateSetting('aiProvider', p.id);
                                        setKeyInput('');
                                        setEditingKey(false);
                                    }}
                                    className={clsx(
                                        'relative flex min-w-0 items-center gap-3 px-3.5 py-3.5 rounded-xl text-left transition-colors border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                                        isSelected
                                            ? 'bg-accent-primary/10 border-accent-primary text-accent ring-1 ring-accent-primary/30'
                                            : 'bg-elevated border-default text-secondary hover:border-strong hover:bg-surface-secondary hover:text-primary',
                                    )}
                                >
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary">
                                        {p.icon}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium leading-5">
                                            {p.label}
                                        </span>
                                        <span className="mt-0.5 block text-xs text-muted">
                                            {t(
                                                p.authentication === 'account'
                                                    ? 'settings.ai.planAccess'
                                                    : p.authentication === 'none'
                                                      ? 'settings.ai.localAccess'
                                                      : 'settings.ai.keyAccess',
                                            )}
                                        </span>
                                    </span>
                                    {isSelected && (
                                        <Check
                                            size={14}
                                            className="shrink-0 text-accent"
                                            aria-hidden="true"
                                        />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </SettingSection>

                {/* Provider configuration */}
                {settings.aiProvider && (settings.aiProvider === 'chatgpt' || selectedProvider) && (
                    <SettingSection
                        title={selectedProvider?.name ?? getProviderLabel(settings.aiProvider)}
                        icon={
                            <SlidersHorizontal
                                size={14}
                                className="text-muted"
                                aria-hidden="true"
                            />
                        }
                    >
                        <div className="mt-3 rounded-xl border border-default bg-elevated px-5">
                            {/* Status badge */}
                            {settings.aiProvider !== 'chatgpt' && (
                                <div className="flex items-center gap-2 py-3">
                                    {aiKeyStatus[settings.aiProvider]?.configured ? (
                                        <>
                                            <span className="text-accent-success flex items-center gap-1 text-xs bg-accent-success/5 px-2 py-0.5 rounded-full border border-accent-success/10">
                                                <CheckCircle2 size={12} />{' '}
                                                {t('settings.ai.configured')}
                                            </span>
                                            {aiKeyStatus[settings.aiProvider]?.fromEnv && (
                                                <span
                                                    className="text-accent flex items-center gap-1 text-xs bg-accent-primary/5 px-2 py-0.5 rounded-full border border-accent-primary/10"
                                                    title={t('settings.ai.fromEnvTooltip')}
                                                >
                                                    <Code2 size={12} /> {t('settings.ai.fromEnv')}
                                                </span>
                                            )}
                                        </>
                                    ) : (
                                        requiresKey &&
                                        !selectedProvider?.ai_assistant.optional_api_key && (
                                            <span className="text-muted text-xs bg-surface-secondary px-2 py-0.5 rounded-full border border-default">
                                                {t('settings.ai.notConfigured')}
                                            </span>
                                        )
                                    )}
                                </div>
                            )}

                            {settings.aiProvider === 'chatgpt' &&
                                platform.negotiation.environment === 'tauri' && <ChatGptSettings />}

                            {/* API Key */}
                            {requiresKey && (
                                <div className="space-y-2 py-3">
                                    <label
                                        htmlFor={`${fieldId}-key`}
                                        className="block text-sm font-medium text-primary"
                                    >
                                        {t('settings.ai.apiKey', {
                                            provider: getProviderLabel(settings.aiProvider),
                                        })}
                                    </label>

                                    {aiKeyStatus[settings.aiProvider]?.configured && !editingKey ? (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-3 bg-base border border-default rounded-lg px-4 py-3">
                                                <Lock
                                                    size={14}
                                                    className="text-accent-success shrink-0"
                                                />
                                                <span className="flex-1 text-sm text-primary font-mono tracking-widest">
                                                    ••••••••••••••••
                                                </span>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {!aiKeyStatus[settings.aiProvider]?.fromEnv && (
                                                        <>
                                                            <button
                                                                onClick={() => {
                                                                    setEditingKey(true);
                                                                    setKeyInput('');
                                                                }}
                                                                className="px-3 py-1 text-xs font-medium text-secondary hover:text-primary bg-surface-secondary hover:bg-surface-tertiary border border-strong rounded-md transition-colors"
                                                            >
                                                                {t('settings.ai.changeKey')}
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    try {
                                                                        await client.call(
                                                                            'delete_ai_key',
                                                                            {
                                                                                provider:
                                                                                    settings.aiProvider!,
                                                                            },
                                                                        );
                                                                        await checkKeys();
                                                                        showAlert(
                                                                            t(
                                                                                'settings.ai.keyResetSuccess',
                                                                            ),
                                                                            {
                                                                                title: t(
                                                                                    'common.success',
                                                                                ),
                                                                                kind: 'info',
                                                                            },
                                                                        );
                                                                    } catch (e) {
                                                                        showAlert(String(e), {
                                                                            title: t(
                                                                                'common.error',
                                                                            ),
                                                                            kind: 'error',
                                                                        });
                                                                    }
                                                                }}
                                                                className="px-3 py-1 text-xs font-medium text-secondary hover:text-accent-error bg-surface-secondary hover:bg-accent-error/10 border border-strong hover:border-accent-error/15 rounded-md transition-colors"
                                                                title={t('settings.ai.resetKey')}
                                                            >
                                                                {t('settings.ai.reset')}
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            {aiKeyStatus[settings.aiProvider]?.fromEnv && (
                                                <p className="text-xs text-accent flex items-center gap-1.5">
                                                    <Info size={12} />
                                                    {t('settings.ai.envVariableDetected')}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex gap-2">
                                                <div className="relative flex-1 group">
                                                    <input
                                                        autoCorrect="off"
                                                        autoCapitalize="off"
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        id={`${fieldId}-key`}
                                                        type={showKey ? 'text' : 'password'}
                                                        value={keyInput}
                                                        placeholder={t('settings.ai.enterKey', {
                                                            provider: getProviderLabel(
                                                                settings.aiProvider,
                                                            ),
                                                        })}
                                                        className="w-full bg-base border border-strong rounded-lg pl-3 pr-10 py-2 text-primary text-sm focus:outline-none focus:border-focus transition-colors"
                                                        onChange={(e) =>
                                                            setKeyInput(e.target.value)
                                                        }
                                                        autoFocus={editingKey}
                                                    />
                                                    <button
                                                        type="button"
                                                        aria-label={t(
                                                            showKey
                                                                ? 'settings.ai.hideKey'
                                                                : 'settings.ai.showKey',
                                                        )}
                                                        aria-pressed={showKey}
                                                        onClick={() => setShowKey(!showKey)}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus rounded"
                                                    >
                                                        {showKey ? (
                                                            <EyeOff size={14} />
                                                        ) : (
                                                            <Eye size={14} />
                                                        )}
                                                    </button>
                                                </div>
                                                <button
                                                    onClick={() =>
                                                        handleSaveKey(settings.aiProvider!)
                                                    }
                                                    disabled={!keyInput.trim()}
                                                    className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 disabled:bg-surface-secondary disabled:text-muted text-inverse rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                                                >
                                                    {t('common.save')}
                                                </button>
                                                {editingKey && (
                                                    <button
                                                        aria-label={t('common.cancel')}
                                                        onClick={() => {
                                                            setEditingKey(false);
                                                            setKeyInput('');
                                                            setShowKey(false);
                                                        }}
                                                        className="px-3 py-2 bg-surface-secondary hover:bg-surface-tertiary text-secondary border border-strong rounded-lg text-sm font-medium transition-colors"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted">
                                                {t('settings.ai.keyStoredSecurely')}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {selectedProvider?.settings.map((definition) => {
                                const value =
                                    settings.plugins?.[selectedProvider.id]?.settings?.[
                                        definition.key
                                    ] ??
                                    definition.default ??
                                    '';
                                const save = (next: unknown) =>
                                    updateSetting('plugins', {
                                        ...settings.plugins,
                                        [selectedProvider.id]: {
                                            ...settings.plugins?.[selectedProvider.id],
                                            settings: {
                                                ...settings.plugins?.[selectedProvider.id]
                                                    ?.settings,
                                                [definition.key]: next,
                                            },
                                        },
                                    });
                                return (
                                    <div key={definition.key} className="space-y-1 py-3">
                                        <label
                                            htmlFor={`${fieldId}-${definition.key}`}
                                            className="block text-sm font-medium text-primary"
                                        >
                                            {definition.label}
                                        </label>
                                        {definition.type === 'boolean' ? (
                                            <input
                                                id={`${fieldId}-${definition.key}`}
                                                type="checkbox"
                                                checked={value === true}
                                                onChange={(event) =>
                                                    void save(event.target.checked)
                                                }
                                            />
                                        ) : definition.options?.length ? (
                                            <Select
                                                id={`${fieldId}-${definition.key}`}
                                                value={String(value)}
                                                options={definition.options}
                                                onChange={(value) => void save(value)}
                                            />
                                        ) : (
                                            <input
                                                id={`${fieldId}-${definition.key}`}
                                                type={
                                                    definition.type === 'number' ? 'number' : 'text'
                                                }
                                                value={String(value)}
                                                required={definition.required}
                                                onChange={(event) =>
                                                    void save(
                                                        definition.type === 'number'
                                                            ? Number(event.target.value)
                                                            : event.target.value,
                                                    )
                                                }
                                                className="w-full bg-base border border-strong rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-focus transition-colors"
                                            />
                                        )}
                                        {definition.description && (
                                            <p className="text-xs text-muted">
                                                {definition.description}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Model selection */}
                            {settings.aiProvider !== 'chatgpt' && (
                                <div className="border-t border-default space-y-2 py-5">
                                    <label
                                        htmlFor={`${fieldId}-model`}
                                        className="block text-sm font-medium text-primary"
                                    >
                                        {t('settings.ai.defaultModel')}
                                    </label>
                                    {(() => {
                                        const currentModels =
                                            settings.aiCustomModels?.[settings.aiProvider] ||
                                            availableModels[settings.aiProvider] ||
                                            [];
                                        const isModelValid =
                                            !settings.aiModel ||
                                            currentModels.includes(settings.aiModel);
                                        return (
                                            <>
                                                <div className="flex gap-2">
                                                    <div className="flex-1">
                                                        <Select
                                                            id={`${fieldId}-model`}
                                                            ariaLabel={t(
                                                                'settings.ai.defaultModel',
                                                            )}
                                                            value={settings.aiModel}
                                                            onChange={(val) =>
                                                                updateSetting('aiModel', val)
                                                            }
                                                            options={currentModels}
                                                            placeholder={t(
                                                                'settings.ai.modelPlaceholder',
                                                            )}
                                                            searchPlaceholder={t(
                                                                'settings.ai.searchPlaceholder',
                                                            )}
                                                            noResultsLabel={t(
                                                                'settings.ai.noResults',
                                                            )}
                                                            hasError={
                                                                !isModelValid && !!settings.aiModel
                                                            }
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => loadModels(true)}
                                                        className="px-3 py-2 bg-surface-secondary hover:bg-surface-tertiary border border-default text-secondary hover:text-primary rounded-lg transition-colors"
                                                        title={t('settings.ai.refresh')}
                                                        aria-label={t('settings.ai.refresh')}
                                                    >
                                                        <RefreshCw size={18} />
                                                    </button>
                                                </div>
                                                {!isModelValid && settings.aiModel && (
                                                    <div className="flex items-center gap-1.5 mt-2 text-xs text-accent-error bg-accent-error/5 p-2 rounded-lg border border-accent-error/10">
                                                        <AlertTriangle
                                                            size={12}
                                                            className="shrink-0"
                                                        />
                                                        <span>
                                                            <Trans
                                                                i18nKey="settings.ai.modelNotFound"
                                                                values={{
                                                                    model: settings.aiModel,
                                                                    provider: getProviderLabel(
                                                                        settings.aiProvider,
                                                                    ),
                                                                }}
                                                                components={{
                                                                    strong: (
                                                                        <strong className="font-semibold" />
                                                                    ),
                                                                }}
                                                            />
                                                        </span>
                                                    </div>
                                                )}
                                                <p className="text-xs text-muted">
                                                    {t('settings.ai.modelDesc')}
                                                </p>
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                            {settings.aiProvider && (
                                <div className="border-t border-default py-5 space-y-2">
                                    <h4 className="flex items-center gap-2 text-sm font-medium text-primary">
                                        <Network
                                            size={15}
                                            className="text-muted"
                                            aria-hidden="true"
                                        />
                                        {t('settings.network.providerProxy')}
                                    </h4>
                                    <p className="text-xs text-muted">
                                        {t('settings.network.providerProxyDesc')}
                                    </p>
                                    <ProxyOverrideEditor
                                        key={settings.aiProvider}
                                        value={
                                            proxyDrafts[settings.aiProvider] ??
                                            settings.aiProviderProxies?.[settings.aiProvider] ??
                                            defaultProxyOverride('inherit')
                                        }
                                        onChange={(next) => {
                                            const provider = settings.aiProvider;
                                            if (!provider) return;
                                            // Keep incomplete endpoints editable while only persisting valid overrides.
                                            setProxyDrafts((drafts) => ({
                                                ...drafts,
                                                [provider]: next,
                                            }));
                                            const normalized = normalizeProxyOverride(next);
                                            const current = {
                                                ...(settings.aiProviderProxies ?? {}),
                                            } as Partial<Record<AiProvider, ProxyOverride>>;
                                            if (!normalized) {
                                                delete current[provider];
                                            } else {
                                                current[provider] = normalized;
                                            }
                                            void updateSetting(
                                                'aiProviderProxies',
                                                Object.keys(current).length > 0 ? current : {},
                                            );
                                        }}
                                        passwordSlot={proxyKeychainAi(settings.aiProvider)}
                                    />
                                </div>
                            )}
                        </div>
                    </SettingSection>
                )}

                {/* Prompt customization */}
                <SettingSection
                    title={t('settings.ai.promptCustomization')}
                    description={t('settings.ai.promptHelp')}
                >
                    <div className="mt-3 divide-y divide-default rounded-xl border border-default bg-elevated overflow-hidden">
                        {(
                            ['system', 'explain', 'cellname', 'tabrename', 'explainplan'] as const
                        ).map((type) => {
                            const isOpen = promptSectionOpen === type;
                            const promptMap = {
                                system: systemPrompt,
                                explain: explainPrompt,
                                cellname: cellnamePrompt,
                                tabrename: tabrenamePrompt,
                                explainplan: explainplanPrompt,
                            };
                            const setPromptMap = {
                                system: setSystemPrompt,
                                explain: setExplainPrompt,
                                cellname: setCellnamePrompt,
                                tabrename: setTabrenamePrompt,
                                explainplan: setExplainplanPrompt,
                            };
                            const prompt = promptMap[type];
                            const setPrompt = setPromptMap[type];
                            return (
                                <div key={type} className="overflow-hidden">
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        aria-controls={`${fieldId}-${type}-panel`}
                                        onClick={() => setPromptSectionOpen(isOpen ? null : type)}
                                        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-surface-secondary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-1.5 rounded-lg bg-surface-secondary text-muted">
                                                <Code2 size={14} />
                                            </div>
                                            <div>
                                                <span className="text-sm font-medium text-primary">
                                                    {t(`settings.ai.${type}Prompt`)}
                                                </span>
                                                <p className="text-xs text-muted mt-0.5">
                                                    {t(`settings.ai.${type}PromptDesc`)}
                                                </p>
                                            </div>
                                        </div>
                                        <ChevronDown
                                            size={16}
                                            className={clsx(
                                                'text-muted transition-transform shrink-0 ml-4',
                                                isOpen && 'rotate-180',
                                            )}
                                        />
                                    </button>
                                    {isOpen && (
                                        <div
                                            id={`${fieldId}-${type}-panel`}
                                            className="px-4 pb-4 pt-3 border-t border-default"
                                        >
                                            <textarea
                                                aria-label={t(`settings.ai.${type}Prompt`)}
                                                autoCorrect="off"
                                                autoCapitalize="off"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={prompt}
                                                onChange={(e) => setPrompt(e.target.value)}
                                                className="w-full h-36 bg-base border border-strong rounded-lg p-3 text-primary text-sm font-mono focus:outline-none focus:border-focus transition-colors resize-y"
                                                placeholder={t(
                                                    `settings.ai.enter${type === 'system' ? 'System' : type === 'explain' ? 'Explain' : type === 'cellname' ? 'Cellname' : 'Tabrename'}Prompt`,
                                                )}
                                            />
                                            <div className="flex justify-end gap-2 mt-3">
                                                <button
                                                    onClick={() => handleResetPrompt(type)}
                                                    className="px-3 py-1.5 bg-surface-secondary hover:bg-surface-tertiary text-secondary rounded-lg text-sm font-medium transition-colors border border-strong"
                                                >
                                                    {t('settings.ai.resetDefault')}
                                                </button>
                                                <button
                                                    onClick={() => handleSavePrompt(type)}
                                                    className="px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors"
                                                >
                                                    {t('settings.ai.savePrompt')}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </SettingSection>
            </fieldset>
        </div>
    );
}
