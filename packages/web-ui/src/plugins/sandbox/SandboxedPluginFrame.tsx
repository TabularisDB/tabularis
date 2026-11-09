import {useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createPortal, flushSync} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {useSettings} from '@/hooks/useSettings';
import {useToast} from '@/hooks/useToast';
import {ThemeContext} from '@/contexts/ThemeContext';
import {isReadOnlyQuery} from '@/utils/sqlAnalysis';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {getActivePlatformCapabilities} from '@/platform/activeCapabilities';
import type {SlotContext} from '@/types/pluginSlots';
import {connectFrame, pluginFrameUrl} from './connectFrame';
import {serializePluginSlotContext} from './slotContext';
import type {RpcPort} from './rpc';

interface Props {
    pluginId: string;
    module: string;
    context: SlotContext;
}

const MAX_HEIGHT = 4000;

function equalJsonValues(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return (
            Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((value, index) => equalJsonValues(value, right[index]))
        );
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord);
    return (
        keys.length === Object.keys(rightRecord).length &&
        keys.every(
            (key) =>
                Object.hasOwn(rightRecord, key) &&
                equalJsonValues(leftRecord[key], rightRecord[key]),
        )
    );
}

export function SandboxedPluginFrame({pluginId, module, context}: Props) {
    const client = useTabularisClient();
    const {settings, updateSetting} = useSettings();
    const {showToast} = useToast();
    const {i18n, t} = useTranslation();
    const language = i18n.resolvedLanguage ?? i18n.language;
    const theme = useContext(ThemeContext);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const rpcRef = useRef<RpcPort | null>(null);
    const legacyOAuthHintShown = useRef(false);
    const guestContext: SlotContext = useMemo(
        () => ({
            ...context,
            pluginSettings: settings.plugins?.[pluginId]?.settings ?? {},
            translations:
                i18n.getResourceBundle(language?.split('-')[0] ?? language, pluginId) ?? {},
            theme: theme
                ? {
                      themeId: theme.currentTheme.id,
                      themeName: theme.currentTheme.name,
                      isDark: theme.currentTheme.monacoTheme.base !== 'vs',
                      colors: theme.currentTheme.colors,
                      layout: theme.currentTheme.layout,
                      typography: theme.currentTheme.typography,
                  }
                : null,
        }),
        [context, i18n, language, pluginId, settings.plugins, theme],
    );
    const contextRef = useRef(guestContext);
    const servicesRef = useRef({client, updateSetting, showToast, t});
    useLayoutEffect(() => {
        servicesRef.current = {client, updateSetting, showToast, t};
    }, [client, updateSetting, showToast, t]);
    const [height, setHeight] = useState(0);
    const [modalOpen, setModalOpen] = useState(false);
    const [frameRect, setFrameRect] = useState({left: 0, top: 0, width: 0});
    const [portalRoot] = useState(() => document.createElement('div'));

    useLayoutEffect(() => {
        let parent = anchorRef.current?.parentElement ?? null;
        while (parent && parent !== document.body) {
            const style = getComputedStyle(parent);
            if (style.position === 'fixed' && style.zIndex !== 'auto') break;
            parent = parent.parentElement;
        }
        (parent ?? document.body).appendChild(portalRoot);
        return () => portalRoot.remove();
    }, [portalRoot]);

    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        const updatePosition = () => {
            const rect = anchor.getBoundingClientRect();
            setFrameRect({left: rect.left, top: rect.top, width: rect.width});
        };
        updatePosition();
        const resizeObserver = new ResizeObserver(updatePosition);
        resizeObserver.observe(anchor);
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [height]);

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        const controller = new AbortController();
        let disposed = false;
        const handlers = {
            'ui.modal': (open: unknown) => {
                if (typeof open !== 'boolean') throw new Error('Modal state must be a boolean');
                if (open && !navigator.userActivation?.isActive) {
                    // Expansion needs a recent user gesture (propagated from the frame to the host).
                    throw new Error('Modal expansion requires a user interaction');
                }
                setModalOpen(open);
            },
            'ui.resize': (value: unknown) => {
                const requested = typeof value === 'number' ? value : 0;
                setHeight(Math.min(MAX_HEIGHT, Math.max(0, requested)));
            },
            'slot.context': () => serializePluginSlotContext(contextRef.current),
            'slot.onDatabaseChange': (value: unknown) => {
                if (typeof value !== 'string') throw new Error('Database must be a string');
                const callback = contextRef.current.onDatabaseChange;
                if (typeof callback !== 'function')
                    throw new Error('Database change is unavailable in this slot');
                callback(value);
            },
            'slot.setExtraField': (key: unknown, value: unknown) => {
                if (
                    typeof key !== 'string' ||
                    !key ||
                    key.length > 256 ||
                    typeof value !== 'string' ||
                    value.length > 16_384
                ) {
                    throw new Error('Invalid connection field value');
                }
                const callback = contextRef.current.setExtraField;
                if (typeof callback !== 'function')
                    throw new Error('Extra fields are unavailable in this slot');
                callback(key, value);
            },
            'slot.setCredentialFieldsHidden': (hidden: unknown) => {
                if (typeof hidden !== 'boolean')
                    throw new Error('Credential visibility must be a boolean');
                const callback = contextRef.current.setCredentialFieldsHidden;
                if (typeof callback !== 'function')
                    throw new Error('Credential fields are unavailable in this slot');
                callback(hidden);
            },
            'slot.setSecretField': (key: unknown, value: unknown) => {
                const normalizedKey = typeof key === 'string' ? key.trim() : '';
                if (
                    !/^[A-Za-z0-9._-]{1,64}$/.test(normalizedKey) ||
                    typeof value !== 'string' ||
                    value.length > 1_048_576
                ) {
                    throw new Error('Invalid plugin secret field');
                }
                const callback = contextRef.current.setSecretField;
                if (typeof callback !== 'function')
                    throw new Error('Secret fields are unavailable in this slot');
                callback(normalizedKey, value);
            },
            'api.query': async (query: unknown) => {
                if (
                    typeof query !== 'string' ||
                    query.trim().length === 0 ||
                    query.length > 100_000
                ) {
                    throw new Error('SQL query must contain between 1 and 100,000 characters');
                }
                if (!isReadOnlyQuery(query)) {
                    throw new Error('Plugin SQL statement type is not allowed by the host filter');
                }
                const active = contextRef.current;
                if (typeof active.connectionId !== 'string' || !active.connectionId) {
                    throw new Error('No active connection');
                }
                return servicesRef.current.client.call('execute_plugin_read_only_query', {
                    connectionId: active.connectionId,
                    query,
                    ...(typeof active.schema === 'string' && active.schema
                        ? {schema: active.schema}
                        : {}),
                });
            },
            'api.toast': async (kind: unknown, text: unknown) => {
                if (typeof text !== 'string' || text.length === 0 || text.length > 4_000) {
                    throw new Error(
                        'Notification text must contain between 1 and 4,000 characters',
                    );
                }
                const toastKind = kind === 'error' || kind === 'warning' ? kind : 'info';
                servicesRef.current.showToast(text, {kind: toastKind});
            },
            'api.setting.set': async (key: unknown, value: unknown) => {
                if (typeof key !== 'string' || !key) throw new Error('Setting key is required');
                const serialized = JSON.stringify(value);
                if (typeof serialized !== 'string' || serialized.length > 65_536) {
                    throw new Error('Plugin settings must be JSON values smaller than 64 KiB');
                }
                const safeValue = JSON.parse(serialized) as unknown;
                // Plugin credentials are shared server configuration. Check authorization
                // before changing the UI: SettingsProvider logs persistence failures.
                try {
                    await servicesRef.current.client.call('get_config', undefined);
                } catch (error) {
                    if (
                        typeof error === 'object' &&
                        error !== null &&
                        'code' in error &&
                        error.code === 'FORBIDDEN'
                    ) {
                        throw new Error(
                            'Changing shared plugin settings requires administrator access.',
                        );
                    }
                    throw error;
                }
                let persistence: Promise<void> = Promise.resolve();
                flushSync(() => {
                    persistence = servicesRef.current.updateSetting('plugins', (previous) => {
                        const plugins = previous ?? {};
                        const pluginConfig = plugins[pluginId] ?? {};
                        return {
                            ...plugins,
                            [pluginId]: {
                                ...pluginConfig,
                                settings: {...(pluginConfig.settings ?? {}), [key]: safeValue},
                            },
                        };
                    });
                });
                await persistence;
                const saved = await servicesRef.current.client.call('get_config', undefined);
                const stored = saved.plugins?.[pluginId]?.settings?.[key];
                if (!equalJsonValues(stored, safeValue)) {
                    throw new Error('Plugin setting could not be saved');
                }
                return null;
            },
            'api.oauth.googleSync': async () => {
                if (pluginId !== 'google-sheets') {
                    throw new Error(
                        'Google OAuth synchronization is only available to Google Sheets',
                    );
                }
                await servicesRef.current.client.call('sync_plugin_settings', {pluginId});
                return null;
            },
            'api.openUrl': async (value: unknown) => {
                if (typeof value !== 'string') throw new Error('URL must be a string');
                const url = new URL(value);
                if (url.protocol !== 'https:' && url.protocol !== 'http:') {
                    throw new Error('Only HTTP and HTTPS URLs can be opened');
                }
                if (url.username || url.password)
                    throw new Error('URLs containing credentials cannot be opened');
                await getActivePlatformCapabilities().openExternalUrl(url.toString());
                return null;
            },
            'api.oauth.googleToken': async (value: unknown) => {
                if (pluginId !== 'google-sheets') {
                    throw new Error(
                        'Google OAuth token exchange is only available to the Google Sheets plugin',
                    );
                }
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    throw new Error('Invalid Google OAuth token request');
                }
                const input = value as Record<string, unknown>;
                const allowed = new Set([
                    'grant_type',
                    'code',
                    'client_id',
                    'client_secret',
                    'redirect_uri',
                    'code_verifier',
                    'refresh_token',
                ]);
                if (Object.keys(input).some((key) => !allowed.has(key))) {
                    throw new Error('Unsupported Google OAuth token field');
                }
                const grantType = input.grant_type;
                if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
                    throw new Error('Unsupported Google OAuth grant type');
                }
                const fields = new URLSearchParams();
                for (const [key, field] of Object.entries(input)) {
                    if (typeof field !== 'string' || !field || field.length > 16_384) {
                        throw new Error(`Invalid Google OAuth field: ${key}`);
                    }
                    fields.set(key, field);
                }
                if (
                    typeof input.client_id !== 'string' ||
                    (grantType === 'authorization_code' &&
                        (typeof input.code !== 'string' ||
                            typeof input.redirect_uri !== 'string')) ||
                    (grantType === 'refresh_token' && typeof input.refresh_token !== 'string')
                ) {
                    throw new Error('Missing required Google OAuth fields');
                }
                const response = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: fields,
                });
                if (!response.ok)
                    throw new Error(`Google OAuth token request failed (${response.status})`);
                const token = (await response.json()) as Record<string, unknown>;
                if (
                    typeof token.access_token !== 'string' ||
                    typeof token.expires_in !== 'number'
                ) {
                    throw new Error('Google returned an invalid token response');
                }
                return {
                    access_token: token.access_token,
                    expires_in: token.expires_in,
                    ...(typeof token.refresh_token === 'string'
                        ? {refresh_token: token.refresh_token}
                        : {}),
                    ...(typeof token.scope === 'string' ? {scope: token.scope} : {}),
                    ...(typeof token.token_type === 'string' ? {token_type: token.token_type} : {}),
                };
            },
            'api.compatibility.legacyGoogleOAuth': () => {
                if (pluginId !== 'google-sheets' || legacyOAuthHintShown.current) return;
                legacyOAuthHintShown.current = true;
                const {showToast, t} = servicesRef.current;
                showToast(t('settings.plugins.legacyGoogleSheetsOAuthHint'), {kind: 'warning'});
            },
            'host.loadFailed': (message: unknown) => {
                console.error(`[PluginSlot] ${pluginId}/${module}: ${String(message)}`);
            },
        };

        void connectFrame(frame, handlers, controller.signal)
            .then(async (rpc) => {
                if (disposed) {
                    rpc.close();
                    return;
                }
                rpcRef.current = rpc;
                try {
                    await rpc.call('slot.context', [
                        serializePluginSlotContext(contextRef.current),
                    ]);
                } catch (error) {
                    console.error(`[PluginSlot] Failed to initialize ${pluginId}/${module}`, error);
                }
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) {
                    console.error(`[PluginSlot] Failed to connect ${pluginId}/${module}`, error);
                }
            });

        return () => {
            disposed = true;
            controller.abort();
            rpcRef.current?.close();
            rpcRef.current = null;
        };
    }, [module, pluginId]);

    useEffect(() => {
        contextRef.current = guestContext;
        void rpcRef.current
            ?.call('slot.context', [serializePluginSlotContext(guestContext)])
            .catch(() => undefined);
    }, [guestContext]);

    const closeModal = () => {
        setModalOpen(false);
        void rpcRef.current?.call('ui.closeModal').catch(() => undefined);
    };

    useEffect(() => {
        if (!modalOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setModalOpen(false);
                void rpcRef.current?.call('ui.closeModal').catch(() => undefined);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [modalOpen]);

    const iframe = (
        <iframe
            ref={frameRef}
            title={`Plugin ${pluginId}`}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            src={pluginFrameUrl(pluginId, module)}
            style={
                modalOpen
                    ? {
                          position: 'fixed',
                          inset: 0,
                          width: '100vw',
                          height: '100dvh',
                          minHeight: '100vh',
                          border: 0,
                          zIndex: 2_147_483_647,
                      }
                    : {
                          position: 'fixed',
                          left: frameRect.left,
                          top: frameRect.top,
                          width: frameRect.width,
                          height,
                          border: 0,
                          zIndex: 1,
                      }
            }
        />
    );
    return (
        <>
            <div
                ref={anchorRef}
                aria-hidden="true"
                style={{width: '100%', height, pointerEvents: 'none'}}
            />
            {createPortal(iframe, portalRoot)}
            {modalOpen &&
                createPortal(
                    <button
                        type="button"
                        aria-label={t('settings.plugins.closePluginOverlay')}
                        title={t('settings.plugins.closePluginOverlay')}
                        onClick={closeModal}
                        className="fixed top-3 right-3 h-8 w-8 rounded-full bg-surface-secondary text-primary border border-default shadow-lg hover:bg-surface-tertiary"
                        style={{zIndex: 2_147_483_647}}
                    >
                        ×
                    </button>,
                    portalRoot,
                )}
        </>
    );
}
