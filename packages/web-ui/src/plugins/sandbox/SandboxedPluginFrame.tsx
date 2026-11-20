import {useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createPortal, flushSync} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router-dom';
import {useSettings} from '@/hooks/useSettings';
import {useToast} from '@/hooks/useToast';
import {ThemeContext} from '@/contexts/ThemeContext';
import {DatabaseContext} from '@/contexts/DatabaseContext';
import {EditorContext} from '@/contexts/EditorContext';
import {buildEditorRoute} from '@/routing';
import {
    createProviderSandboxHandlers,
    openProviderWorkspace,
    providerString,
} from '@/utils/providerSandbox';
import {parsePluginNativeComponent, parsePluginNativeRect} from '@/utils/pluginNative';
import {publishPluginEvent, subscribePluginEvent} from '@/utils/pluginEvents';
import {fitFrameHeight, frameScrollports} from '@/utils/pluginFrameFit';
import type {PluginNativeComponent} from '@/types/pluginNative';
import {NativePluginComponent} from './NativePluginComponent';
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
    const database = useContext(DatabaseContext);
    const editor = useContext(EditorContext);
    const navigate = useNavigate();
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
            providerConnections: (database?.connections ?? [])
                .filter((connection) => connection.params.driver === pluginId)
                .map(({id, name}) => ({id, name})),
            activeWorkspaceId:
                editor?.activeTab?.type === 'plugin-workspace' &&
                editor.activeTab.pluginId === pluginId
                    ? editor.activeTab.workspaceId
                    : null,
            commonTranslations:
                i18n.getResourceBundle(language?.split('-')[0] ?? language, 'translation')
                    ?.common ?? {},
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
        [
            context,
            database?.connections,
            editor?.activeTab,
            i18n,
            language,
            pluginId,
            settings.plugins,
            theme,
        ],
    );
    const contextRef = useRef(guestContext);
    const servicesRef = useRef({client, updateSetting, showToast, t, database, editor, navigate});
    useLayoutEffect(() => {
        servicesRef.current = {client, updateSetting, showToast, t, database, editor, navigate};
    }, [client, updateSetting, showToast, t, database, editor, navigate]);
    const [nativeComponents, setNativeComponents] = useState<PluginNativeComponent[]>([]);
    // What the guest's content measures, and the canvas the host gives it.
    const [contentHeight, setContentHeight] = useState(0);
    const [height, setHeight] = useState(0);
    const [intrinsicWidth, setIntrinsicWidth] = useState(0);
    const [modalOpen, setModalOpen] = useState(false);
    const [openPopovers, setOpenPopovers] = useState<ReadonlySet<string>>(() => new Set());
    const workspace = context.__tabularisSlot === 'editor.workspace.content';
    const frameVisible = context.workspaceActive !== false;
    const expanded = modalOpen && frameVisible;
    const [frameRect, setFrameRect] = useState({
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        clip: 'none',
        visibleTop: 0,
        visibleBottom: 0,
        visibleLeft: 0,
        visibleRight: 0,
    });
    const viewportRef = useRef({top: 0, bottom: 0, left: 0, right: 0});
    const [portalRoot] = useState(() => document.createElement('div'));
    const [resolvedFrame, setResolvedFrame] = useState<{
        pluginId: string;
        module: string;
        url: string;
    } | null>(null);
    const frameUrl =
        resolvedFrame?.pluginId === pluginId && resolvedFrame.module === module
            ? resolvedFrame.url
            : null;

    useEffect(() => {
        let cancelled = false;
        void Promise.resolve(pluginFrameUrl(pluginId, module))
            .then((url) => {
                if (!cancelled) setResolvedFrame({pluginId, module, url});
            })
            .catch((error: unknown) => {
                if (!cancelled)
                    console.error(`[PluginSlot] Failed to authorize ${pluginId}/${module}`, error);
            });
        return () => {
            cancelled = true;
        };
    }, [pluginId, module]);

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
        if (!anchor || workspace) return;
        const fit = () => setHeight(fitFrameHeight(anchor, contentHeight));
        fit();
        // The room changes with the host layout, not only with the guest's content.
        const resizeObserver = new ResizeObserver(fit);
        for (const scrollport of frameScrollports(anchor)) resizeObserver.observe(scrollport);
        window.addEventListener('resize', fit);
        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', fit);
        };
    }, [contentHeight, workspace]);

    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        let last: typeof frameRect | null = null;
        const updatePosition = () => {
            const rect = anchor.getBoundingClientRect();
            const canvasHeight = workspace ? rect.height : height;
            let left = rect.left;
            let right = rect.right;
            let top = rect.top;
            let bottom = rect.top + canvasHeight;
            for (
                let parent = anchor.parentElement;
                parent && parent !== document.body;
                parent = parent.parentElement
            ) {
                const style = getComputedStyle(parent);
                const clipsX = /^(auto|scroll|hidden|clip)$/.test(
                    style.overflowX || style.overflow,
                );
                const clipsY = /^(auto|scroll|hidden|clip)$/.test(
                    style.overflowY || style.overflow,
                );
                if (!clipsX && !clipsY) continue;
                const bounds = parent.getBoundingClientRect();
                const contentLeft = bounds.left + parent.clientLeft;
                const contentTop = bounds.top + parent.clientTop;
                if (clipsX) {
                    left = Math.max(left, contentLeft);
                    right = Math.min(right, contentLeft + parent.clientWidth);
                }
                if (clipsY) {
                    top = Math.max(top, contentTop);
                    bottom = Math.min(bottom, contentTop + parent.clientHeight);
                }
            }
            const clamp = (value: number, size: number) => Math.min(size, Math.max(0, value));
            const insets = [
                clamp(top - rect.top, canvasHeight),
                clamp(rect.right - right, rect.width),
                clamp(rect.top + canvasHeight - bottom, canvasHeight),
                clamp(left - rect.left, rect.width),
            ];
            const clip = insets.every((inset) => inset === 0)
                ? 'none'
                : `inset(${insets.map((inset) => `${inset}px`).join(' ')})`;
            if (
                last?.left === rect.left &&
                last.top === rect.top &&
                last.width === rect.width &&
                last.height === canvasHeight &&
                last.clip === clip
            )
                return;
            last = {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: canvasHeight,
                clip,
                visibleTop: insets[0],
                visibleBottom: canvasHeight - insets[2],
                visibleLeft: insets[3],
                visibleRight: rect.width - insets[1],
            };
            setFrameRect(last);
        };
        updatePosition();
        let animationFrame = 0;
        const trackLayout = () => {
            updatePosition();
            animationFrame = window.requestAnimationFrame(trackLayout);
        };
        if (height > 0 || workspace) animationFrame = window.requestAnimationFrame(trackLayout);
        const resizeObserver = new ResizeObserver(updatePosition);
        resizeObserver.observe(anchor);
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            resizeObserver.disconnect();
            window.cancelAnimationFrame(animationFrame);
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [height, workspace]);

    useEffect(() => {
        const sendViewport = () => {
            const viewport = expanded
                ? {top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth}
                : {
                      top: frameRect.visibleTop,
                      bottom: frameRect.visibleBottom,
                      left: frameRect.visibleLeft,
                      right: frameRect.visibleRight,
                  };
            if (viewport.bottom <= viewport.top || viewport.right <= viewport.left) return;
            viewportRef.current = viewport;
            void rpcRef.current?.call('ui.viewport', [viewport]).catch(() => undefined);
        };
        sendViewport();
        window.addEventListener('resize', sendViewport);
        return () => window.removeEventListener('resize', sendViewport);
    }, [expanded, frameRect]);

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        const controller = new AbortController();
        let disposed = false;
        const eventSubscriptions = new Map<string, () => void>();
        const handlers = {
            'api.event.publish': (name: unknown, detail: unknown) =>
                publishPluginEvent(pluginId, providerString(name, 'plugin event name', 64), detail),
            'api.event.subscribe': (name: unknown) => {
                const eventName = providerString(name, 'plugin event name', 64);
                if (!eventSubscriptions.has(eventName)) {
                    if (eventSubscriptions.size >= 64)
                        throw new Error('Too many plugin event subscriptions');
                    eventSubscriptions.set(
                        eventName,
                        subscribePluginEvent(pluginId, eventName, (detail) => {
                            void rpcRef.current
                                ?.call('api.event', [eventName, detail])
                                .catch(() => undefined);
                        }),
                    );
                }
                return null;
            },
            'api.event.unsubscribe': (name: unknown) => {
                const eventName = providerString(name, 'plugin event name', 64);
                eventSubscriptions.get(eventName)?.();
                eventSubscriptions.delete(eventName);
                return null;
            },
            ...createProviderSandboxHandlers(pluginId, () => ({
                client: servicesRef.current.client,
                context: contextRef.current,
                connections: servicesRef.current.database?.connections ?? [],
                loadConnections: async () => {
                    await servicesRef.current.database?.loadConnections();
                },
                openConnection: async (connectionId, sourceId) => {
                    const current = servicesRef.current.database;
                    if (!current) throw new Error('Provider connections are unavailable');
                    if (sourceId && current.activeConnectionId !== sourceId)
                        throw new Error('The source connection is no longer active');
                    // Recheck ownership in persisted metadata before activating the connection.
                    const saved = await servicesRef.current.client.call('get_connection_by_id', {
                        id: connectionId,
                    });
                    if (saved.params.driver !== pluginId)
                        throw new Error('Connection belongs to another provider');
                    if (sourceId && servicesRef.current.database?.activeConnectionId !== sourceId)
                        throw new Error('The source connection is no longer active');
                    if (current.openConnectionIds.includes(connectionId))
                        current.switchConnection(connectionId);
                    else await current.connect(connectionId);
                    servicesRef.current.navigate(buildEditorRoute(connectionId));
                },
                openWorkspace: (options) => {
                    const current = servicesRef.current;
                    if (
                        !current.editor ||
                        options.connectionId !== current.database?.activeConnectionId
                    )
                        throw new Error('Select the workspace connection before opening it');
                    const id = openProviderWorkspace(current.editor, pluginId, options);
                    current.navigate(buildEditorRoute(options.connectionId));
                    return id;
                },
            })),
            'slot.onConnectionCreated': async () => {
                const callback = contextRef.current.onConnectionCreated;
                if (typeof callback !== 'function')
                    throw new Error('Connection creation callback is unavailable');
                await callback();
                return null;
            },
            'slot.onClose': () => {
                const callback = contextRef.current.onClose;
                if (typeof callback !== 'function')
                    throw new Error('Close callback is unavailable');
                callback();
                return null;
            },
            'api.copyText': async (value: unknown) => {
                if (typeof value !== 'string' || value.length > 1_048_576)
                    throw new Error('Invalid clipboard text');
                await getActivePlatformCapabilities().writeClipboard(value);
                return null;
            },
            'ui.native.set': (value: unknown) => {
                const component = parsePluginNativeComponent(
                    value,
                    contextRef.current.connectionId,
                );
                setNativeComponents((previous) => {
                    if (previous.length >= 32 && !previous.some((item) => item.id === component.id))
                        return previous;
                    return [...previous.filter((item) => item.id !== component.id), component];
                });
                return null;
            },
            'ui.native.bounds': (value: unknown, bounds: unknown, modal: unknown = false) => {
                const id = providerString(value, 'native component ID', 128);
                const rect = parsePluginNativeRect(bounds);
                if (typeof modal !== 'boolean') throw new Error('Invalid native component layer');
                setNativeComponents((previous) =>
                    previous.map((item) => (item.id === id ? {...item, rect, modal} : item)),
                );
                return null;
            },
            'ui.native.remove': (value: unknown) => {
                const id = providerString(value, 'native component ID', 128);
                setNativeComponents((previous) => previous.filter((item) => item.id !== id));
                return null;
            },
            'ui.modal': (open: unknown) => {
                if (typeof open !== 'boolean') throw new Error('Modal state must be a boolean');
                if (open && contextRef.current.workspaceActive === false)
                    throw new Error('Inactive workspaces cannot open overlays');
                if (open && !navigator.userActivation?.isActive) {
                    // Expansion needs a recent user gesture (propagated from the frame to the host).
                    throw new Error('Modal expansion requires a user interaction');
                }
                setModalOpen(open);
                if (open) void rpcRef.current?.call('ui.closePopovers').catch(() => undefined);
            },
            'ui.popover': (value: unknown, open: unknown) => {
                const id = providerString(value, 'popover ID', 128);
                if (typeof open !== 'boolean') throw new Error('Popover state must be a boolean');
                if (open && contextRef.current.workspaceActive === false)
                    throw new Error('Inactive workspaces cannot open popovers');
                setOpenPopovers((previous) => {
                    if (previous.has(id) === open || (open && previous.size >= 32)) return previous;
                    const next = new Set(previous);
                    if (open) next.add(id);
                    else next.delete(id);
                    return next;
                });
                return null;
            },
            'ui.resize': (value: unknown, width: unknown) => {
                if (contextRef.current.__tabularisSlot === 'editor.workspace.content') return;
                const requested = typeof value === 'number' && Number.isFinite(value) ? value : 0;
                setContentHeight(Math.min(MAX_HEIGHT, Math.max(0, requested)));
                if (
                    [
                        'connections.actions',
                        'sidebar.footer.actions',
                        'explorer.connection.actions',
                        'data-grid.toolbar.actions',
                    ].includes(String(contextRef.current.__tabularisSlot)) &&
                    typeof width === 'number' &&
                    Number.isFinite(width)
                )
                    setIntrinsicWidth(Math.min(640, Math.max(0, width)));
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
                    if (viewportRef.current.bottom > viewportRef.current.top)
                        await rpc.call('ui.viewport', [viewportRef.current]);
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
            for (const unsubscribe of eventSubscriptions.values()) unsubscribe();
            eventSubscriptions.clear();
            controller.abort();
            rpcRef.current?.close();
            rpcRef.current = null;
            setNativeComponents([]);
            setOpenPopovers(new Set());
        };
    }, [module, pluginId, frameUrl]);

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

    const iframe = frameUrl && (
        <div
            data-plugin-frame={pluginId}
            style={
                expanded
                    ? {
                          position: 'fixed',
                          inset: 0,
                          width: '100vw',
                          height: '100dvh',
                          minHeight: '100vh',
                          border: 0,
                          zIndex: 2_147_483_647,
                          overflow: 'hidden',
                          pointerEvents: 'none',
                          visibility: frameVisible ? undefined : 'hidden',
                      }
                    : {
                          position: 'fixed',
                          left: frameRect.left,
                          top: frameRect.top,
                          width: frameRect.width,
                          height: workspace ? frameRect.height : height,
                          clipPath: frameRect.clip,
                          border: 0,
                          zIndex: 1,
                          overflow: 'hidden',
                          pointerEvents: 'none',
                          visibility: frameVisible ? undefined : 'hidden',
                      }
            }
        >
            <iframe
                ref={frameRef}
                title={`Plugin ${pluginId}`}
                data-plugin-slot={
                    typeof context.__tabularisSlot === 'string'
                        ? context.__tabularisSlot
                        : undefined
                }
                data-plugin-workspace={
                    typeof context.workspaceId === 'string' ? context.workspaceId : undefined
                }
                data-plugin-active={frameVisible ? 'true' : 'false'}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                src={frameUrl}
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    border: 0,
                    pointerEvents: 'auto',
                }}
            />
            {nativeComponents.map((component) => (
                <NativePluginComponent
                    key={component.id}
                    component={component}
                    hidden={Boolean(component.modal) !== expanded || openPopovers.size > 0}
                    emit={(id, event, value) => {
                        void rpcRef.current
                            ?.call('ui.native.event', [id, event, value])
                            .catch(() => undefined);
                    }}
                />
            ))}
        </div>
    );
    return (
        <>
            <div
                ref={anchorRef}
                aria-hidden="true"
                style={{
                    width: '100%',
                    minWidth: intrinsicWidth || undefined,
                    maxWidth: '100%',
                    height: workspace ? '100%' : height,
                    flex: workspace ? '1 1 0%' : undefined,
                    minHeight: workspace ? 0 : undefined,
                    pointerEvents: 'none',
                }}
            />
            {createPortal(iframe, portalRoot)}
            {expanded &&
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
