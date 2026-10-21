import * as React from 'react';
import * as ReactJSXRuntime from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';
import * as explainApi from '@tabularis/explain';
import {RpcPort} from '../../../src/plugins/sandbox/rpc';
import {hydratePluginSlotContext} from '../../../src/plugins/sandbox/slotContext';

type PluginComponent = React.ComponentType<{context: Record<string, unknown>; pluginId: string}>;
type GuestGlobal = Window & Record<string, unknown>;

const guestWindow = window as unknown as GuestGlobal;
const params = new URLSearchParams(location.search);
const modulePath = params.get('module') ?? '';
const mode = params.get('mode') ?? 'ui';
const pluginId = decodeURIComponent(location.pathname.split('/')[1] ?? '');
const QUERY_RPC_TIMEOUT_MS = 5 * 60_000;
let currentContext: Record<string, unknown> = {};
let renderPlugin: (() => void) | undefined;
let explainModulePromise: Promise<Record<string, unknown>[]> | undefined;
let rpcPort: RpcPort | undefined;

interface GuestModalOptions {
    title: string;
    content: React.ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

interface GuestModalApi {
    openModal: (options: GuestModalOptions) => void;
    closeModal: () => void;
}

const GuestModalContext = React.createContext<GuestModalApi | null>(null);

function defineSlot(slot: string, component: unknown) {
    return {__slot: slot, component} as const;
}

/** The UI extension API deliberately contains no Tauri or generic invoke access. */
const guestApi = Object.freeze({
    // Compatibility for bundles built against older plugin-api versions that
    // called getHost() for host APIs. Return only this restricted guest facade.
    getHost: () => guestApi,
    defineSlot,
    usePluginConnection: () => ({
        connectionId: currentContext.connectionId ?? null,
        driver: currentContext.driver ?? null,
        schema: currentContext.schema ?? null,
    }),
    usePluginQuery: () => {
        const [loading, setLoading] = React.useState(false);
        const [error, setError] = React.useState<string | null>(null);
        const executeQuery = React.useCallback(async (query: string) => {
            if (!rpcPort) throw new Error('Plugin host connection is unavailable');
            setLoading(true);
            setError(null);
            try {
                return (await rpcPort.call('api.query', [query], QUERY_RPC_TIMEOUT_MS)) as {
                    columns: string[];
                    rows: unknown[][];
                };
            } catch (failure) {
                const message = failure instanceof Error ? failure.message : String(failure);
                setError(message);
                throw new Error(message);
            } finally {
                setLoading(false);
            }
        }, []);
        return {executeQuery, loading, error};
    },
    usePluginToast: () => ({
        showInfo: (text: string) => callHost('api.toast', 'info', text),
        showError: (text: string) => callHost('api.toast', 'error', text),
        showWarning: (text: string) => callHost('api.toast', 'warning', text),
    }),
    usePluginSetting: (requestedPluginId: string) => {
        if (requestedPluginId !== pluginId)
            throw new Error('Plugins may only access their own settings');
        const settings = asRecord(currentContext.pluginSettings);
        const getSetting = <T>(key: string, defaultValue?: T): T =>
            (Object.hasOwn(settings, key) ? settings[key] : defaultValue) as T;
        const setSetting = async (key: string, value: unknown): Promise<void> => {
            await callHost('api.setting.set', key, value);
            currentContext = {
                ...currentContext,
                pluginSettings: {...asRecord(currentContext.pluginSettings), [key]: value},
            };
            renderPlugin?.();
        };
        const setSettings = async (updates: Record<string, unknown>): Promise<void> => {
            for (const [key, value] of Object.entries(updates)) await setSetting(key, value);
        };
        return {getSetting, setSetting, setSettings};
    },
    usePluginTranslation: (requestedPluginId: string) => {
        if (requestedPluginId !== pluginId)
            throw new Error('Plugins may only access their own translations');
        const translations = asRecord(currentContext.translations);
        return (key: string, options?: Record<string, unknown>): string => {
            let value: unknown = translations;
            for (const part of key.split('.')) value = asRecord(value)[part];
            const {defaultValue, ...interpolations} = options ?? {};
            let translated =
                typeof value === 'string'
                    ? value
                    : typeof defaultValue === 'string'
                      ? defaultValue
                      : key;
            for (const [name, replacement] of Object.entries(interpolations)) {
                translated = translated.replaceAll(`{{${name}}}`, String(replacement));
            }
            return translated;
        };
    },
    usePluginModal: () => {
        const api = React.useContext(GuestModalContext);
        if (!api) throw new Error('Plugin modal API must be used inside a plugin component');
        return api;
    },
    usePluginTheme: () => {
        const theme = asRecord(currentContext.theme);
        return {
            themeId: typeof theme.themeId === 'string' ? theme.themeId : null,
            themeName: typeof theme.themeName === 'string' ? theme.themeName : null,
            isDark: theme.isDark === true,
            colors: Object.keys(asRecord(theme.colors)).length > 0 ? asRecord(theme.colors) : null,
        };
    },
    openUrl: (url: string) => callHost('api.openUrl', url),
    exchangeGoogleOAuthToken: (request: unknown) =>
        callHostResult('api.oauth.googleToken', request),
});

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function callHost(method: string, ...args: unknown[]): Promise<void> {
    if (!rpcPort) return Promise.reject(new Error('Plugin host connection is unavailable'));
    return rpcPort.call(method, args).then(() => undefined);
}

function callHostResult<T>(method: string, ...args: unknown[]): Promise<T> {
    if (!rpcPort) return Promise.reject(new Error('Plugin host connection is unavailable'));
    return rpcPort.call(method, args) as Promise<T>;
}

window.addEventListener('securitypolicyviolation', (event) => {
    if (pluginId !== 'google-sheets' || event.effectiveDirective !== 'connect-src') return;
    try {
        if (new URL(event.blockedURI).origin !== 'https://oauth2.googleapis.com') return;
    } catch {
        return;
    }
    void callHost('api.compatibility.legacyGoogleOAuth').catch(() => undefined);
});

function GuestRoot({component: Component}: {component: PluginComponent}) {
    const [modal, setModal] = React.useState<GuestModalOptions | null>(null);
    const modalApi = React.useMemo(
        () => ({
            openModal: (options: GuestModalOptions) => setModal(options),
            closeModal: () => setModal(null),
        }),
        [],
    );
    React.useEffect(() => {
        void callHost('ui.modal', modal !== null).catch(() => undefined);
    }, [modal]);
    const modalStyle: React.CSSProperties = {
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'rgba(0,0,0,.6)',
    };
    const dialogStyle: React.CSSProperties = {
        width:
            modal?.size === 'sm'
                ? 'min(100%, 500px)'
                : modal?.size === 'md'
                  ? 'min(100%, 700px)'
                  : modal?.size === 'xl'
                    ? 'min(100%, 1100px)'
                    : 'min(100%, 900px)',
        maxHeight: '90%',
        overflow: 'auto',
        background: themeColor('bg', 'elevated', '#111827'),
        color: themeColor('text', 'primary', '#f9fafb'),
        border: `1px solid ${themeColor('border', 'default', '#374151')}`,
        borderRadius: 12,
        padding: 16,
    };
    return React.createElement(
        GuestModalContext.Provider,
        {value: modalApi},
        React.createElement(Component, {context: currentContext, pluginId}),
        modal &&
            React.createElement(
                'div',
                {
                    style: modalStyle,
                    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
                        if (event.target === event.currentTarget) modalApi.closeModal();
                    },
                },
                React.createElement(
                    'section',
                    {
                        role: 'dialog',
                        'aria-modal': true,
                        'aria-label': modal.title,
                        style: dialogStyle,
                        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                            if (event.key === 'Escape') modalApi.closeModal();
                        },
                        tabIndex: -1,
                    },
                    React.createElement(
                        'header',
                        {
                            style: {
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: 12,
                            },
                        },
                        React.createElement('h2', null, modal.title),
                        React.createElement(
                            'button',
                            {
                                type: 'button',
                                onClick: modalApi.closeModal,
                                'aria-label': 'Close dialog',
                            },
                            '×',
                        ),
                    ),
                    modal.content,
                ),
            ),
    );
}

const THEME_CSS_VARIABLES: Record<string, Record<string, string>> = {
    bg: {
        base: '--bg-base',
        elevated: '--bg-elevated',
        overlay: '--bg-overlay',
        input: '--bg-input',
        tooltip: '--bg-tooltip',
    },
    surface: {
        primary: '--surface-primary',
        secondary: '--surface-secondary',
        tertiary: '--surface-tertiary',
        hover: '--surface-hover',
        active: '--surface-active',
        disabled: '--surface-disabled',
    },
    text: {
        primary: '--text-primary',
        secondary: '--text-secondary',
        muted: '--text-muted',
        disabled: '--text-disabled',
        accent: '--text-accent',
        inverse: '--text-inverse',
    },
    accent: {
        primary: '--accent-primary',
        secondary: '--accent-secondary',
        success: '--accent-success',
        warning: '--accent-warning',
        error: '--accent-error',
        info: '--accent-info',
    },
    border: {
        subtle: '--border-subtle',
        default: '--border-default',
        strong: '--border-strong',
        focus: '--border-focus',
    },
    semantic: {
        string: '--semantic-string',
        number: '--semantic-number',
        boolean: '--semantic-boolean',
        date: '--semantic-date',
        null: '--semantic-null',
        primaryKey: '--semantic-pk',
        foreignKey: '--semantic-fk',
        index: '--semantic-index',
        modified: '--semantic-modified',
        deleted: '--semantic-deleted',
        new: '--semantic-new',
    },
};

function applyGuestTheme(): void {
    const theme = asRecord(currentContext.theme);
    const colors = asRecord(theme.colors);
    const root = document.documentElement;
    root.style.colorScheme = theme.isDark === true ? 'dark' : 'light';
    for (const [group, tokens] of Object.entries(THEME_CSS_VARIABLES)) {
        const values = asRecord(colors[group]);
        for (const [token, variable] of Object.entries(tokens)) {
            const value = values[token];
            if (typeof value === 'string') root.style.setProperty(variable, value);
        }
    }
    const textColor = asRecord(colors.text).primary;
    if (typeof textColor === 'string') document.body.style.color = textColor;
}

function themeColor(group: string, token: string, fallback: string): string {
    const colors = asRecord(asRecord(currentContext.theme).colors);
    const value = asRecord(colors[group])[token];
    return typeof value === 'string' ? value : fallback;
}

Object.assign(guestWindow, {
    React,
    ReactJSXRuntime,
    __TABULARIS_EXPLAIN__: explainApi,
    __TABULARIS_API__: guestApi,
    __TABULARIS_API_VERSION__: '0.4.0',
});

function loadExplainModule(): Promise<Record<string, unknown>[]> {
    if (explainModulePromise) return explainModulePromise;
    explainModulePromise = new Promise((resolve, reject) => {
        const pluginScript = document.createElement('script');
        pluginScript.src = `/${encodeURIComponent(pluginId)}/${modulePath.replace(/^\.\//, '').replace(/^\//, '')}`;
        pluginScript.onload = () => {
            const raw = guestWindow.__tabularis_explain_parser__;
            const exported =
                raw &&
                typeof raw === 'object' &&
                Object.prototype.hasOwnProperty.call(raw, 'default')
                    ? (raw as {default: unknown}).default
                    : raw;
            const candidates =
                exported == null ? [] : Array.isArray(exported) ? exported : [exported];
            const parsers = candidates.filter(
                (value): value is Record<string, unknown> =>
                    !!value &&
                    typeof value === 'object' &&
                    typeof (value as Record<string, unknown>).engine === 'string' &&
                    typeof (value as Record<string, unknown>).format === 'string' &&
                    typeof (value as Record<string, unknown>).parse === 'function',
            );
            resolve(parsers);
        };
        pluginScript.onerror = () => reject(new Error('Plugin parser bundle failed to load'));
        document.head.append(pluginScript);
    });
    return explainModulePromise;
}

function start(port: MessagePort): void {
    const rpc = new RpcPort(port, async (method, args) => {
        if (mode === 'explain') {
            const values = Array.isArray(args) ? args : [args];
            if (method === 'explain.load') {
                if (values[0] !== modulePath) throw new Error('module_mismatch');
                const parsers = await loadExplainModule();
                return parsers.map((parser) => ({
                    engine: parser.engine,
                    format: parser.format,
                    ...(typeof parser.label === 'string' ? {label: parser.label} : {}),
                    hasSniff: typeof parser.sniff === 'function',
                }));
            }
            if (method === 'explain.parse' || method === 'explain.sniff') {
                const [format, payload] = values;
                if (typeof format !== 'string' || typeof payload !== 'string') {
                    throw new Error('invalid_parser_arguments');
                }
                const parser = (await loadExplainModule()).find(
                    (candidate) => candidate.format === format,
                );
                if (!parser) throw new Error('parser_not_found');
                if (method === 'explain.parse') {
                    return (parser.parse as (raw: string) => unknown)(payload);
                }
                if (typeof parser.sniff !== 'function') return false;
                return (parser.sniff as (raw: string) => unknown)(payload);
            }
            throw new Error('method_not_allowed');
        }
        if (method === 'slot.context') {
            const next = Array.isArray(args) ? args[0] : args;
            if (next && typeof next === 'object' && !Array.isArray(next)) {
                currentContext = hydratePluginSlotContext(
                    next as Record<string, unknown>,
                    (callback, ...values) => {
                        void rpc.call(callback, values).catch(() => undefined);
                    },
                );
                applyGuestTheme();
                renderPlugin?.();
            }
            return null;
        }
        throw new Error('method_not_allowed');
    });
    rpcPort = rpc;

    if (mode === 'explain') return;

    const pluginScript = document.createElement('script');
    pluginScript.src = `/${encodeURIComponent(pluginId)}/${modulePath.replace(/^\.\//, '').replace(/^\//, '')}`;
    pluginScript.onload = () => {
        const raw = guestWindow.__tabularis_plugin__;
        const component =
            typeof raw === 'function'
                ? raw
                : raw && typeof raw === 'object'
                  ? (raw as {default?: unknown}).default
                  : null;
        if (typeof component !== 'function') {
            void rpc
                .call('host.loadFailed', ['Plugin bundle has no default component export'])
                .catch(() => undefined);
            return;
        }

        const rootElement = document.getElementById('root');
        if (!rootElement) return;
        const root = createRoot(rootElement);
        renderPlugin = () =>
            root.render(React.createElement(GuestRoot, {component: component as PluginComponent}));
        renderPlugin();
        const resizeObserver = new ResizeObserver(() => {
            void rpc
                .call('ui.resize', [document.documentElement.scrollHeight])
                .catch(() => undefined);
        });
        resizeObserver.observe(document.body);
    };
    pluginScript.onerror = () => {
        void rpc.call('host.loadFailed', ['Plugin bundle failed to load']).catch(() => undefined);
    };
    document.head.append(pluginScript);
}

const announceReady = () => window.parent.postMessage({type: 'tabularis:ready'}, '*');
const readyTimer = window.setInterval(announceReady, 100);
announceReady();

window.addEventListener('message', function onInit(event: MessageEvent) {
    if (event.source !== window.parent || event.data?.type !== 'tabularis:init') return;
    const port = event.ports[0];
    if (!port) return;
    window.clearInterval(readyTimer);
    window.removeEventListener('message', onInit);
    start(port);
});
