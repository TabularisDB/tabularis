import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useId} from 'react';
import {createInstance} from 'i18next';
import {I18nextProvider} from 'react-i18next';
import {PluginConnectionAction} from '@/components/plugins/PluginConnectionAction';
import {PluginWorkspaceShell} from '@/components/plugins/PluginWorkspaceShell';
import {PluginResourceList} from '@/components/plugins/PluginResourceList';
import {PluginSelect} from '@/components/plugins/PluginSelect';
import {Accordion} from '@/components/layout/sidebar/Accordion';
import type {PluginExplorerSectionProps} from '@/types/pluginExplorerSection';
import type {PluginCodeEditorProps} from '@/types/pluginResources';
import type {PluginDataGridProps} from '@/types/pluginDataGrid';
import type {PluginSelectProps} from '@/types/pluginSelect';
import type {UsePluginAccountReturn} from '@/types/pluginAccount';
import type {UsePluginRpcReturn} from '@/types/pluginRpc';
import type {OpenPluginWorkspaceOptions} from '@/types/pluginWorkspaceTab';
import {getPluginNativeBounds} from '@/utils/pluginNativeGeometry';
import {getPluginExplorerIcon} from '@/utils/pluginExplorerIcons';

type HostCall = (method: string, ...values: unknown[]) => Promise<unknown>;
type GuestContext = Record<string, unknown>;

/** Provider UI uses scoped MessagePort requests; no host objects cross into the guest. */
export function createProviderGuestApi(
    pluginId: string,
    context: () => GuestContext,
    call: HostCall,
) {
    const nativeEvents = new Map<string, (event: string, value: unknown) => void>();
    const pluginEvents = new Map<string, Set<(detail: unknown) => void>>();
    const reservations = new Map<string, string>();
    const i18n = createInstance();
    void i18n.init({
        lng: 'en',
        fallbackLng: 'en',
        initAsync: false,
        resources: {
            en: {
                translation: {
                    common: {loading: 'Loading', search: 'Search', noResults: 'No results'},
                },
            },
        },
    });
    const ownPlugin = (requested: string) => {
        if (requested !== pluginId) throw new Error('Plugins may only access their own provider');
    };
    const report = (error: unknown) => {
        void call(
            'api.toast',
            'error',
            error instanceof Error ? error.message : String(error),
        ).catch(() => undefined);
    };
    function usePluginEvent(requested: string, name: string, listener: (detail: unknown) => void) {
        ownPlugin(requested);
        const listenerRef = useRef(listener);
        useLayoutEffect(() => {
            listenerRef.current = listener;
        }, [listener]);
        useEffect(() => {
            const listeners = pluginEvents.get(name) ?? new Set<(detail: unknown) => void>();
            const callback = (detail: unknown) => listenerRef.current(detail);
            if (!listeners.size) void call('api.event.subscribe', name).catch(report);
            listeners.add(callback);
            pluginEvents.set(name, listeners);
            return () => {
                listeners.delete(callback);
                if (!listeners.size) {
                    pluginEvents.delete(name);
                    void call('api.event.unsubscribe', name).catch(() => undefined);
                }
            };
        }, [name]);
    }
    function usePluginRpc(requested: string, requestedConnection?: string): UsePluginRpcReturn {
        ownPlugin(requested);
        const connectionId = requestedConnection ?? context().connectionId;
        return useMemo(
            () => ({
                call: <T,>(method: string, args: Record<string, unknown> = {}) =>
                    call('provider.connection', 'call', connectionId, method, args) as Promise<T>,
                saveSecrets: (secrets: Record<string, string>) =>
                    call('provider.connection', 'saveSecrets', connectionId, secrets).then(
                        () => undefined,
                    ),
                secretFields: () =>
                    call('provider.connection', 'secretFields', connectionId) as Promise<string[]>,
                deleteSecrets: () =>
                    call('provider.connection', 'deleteSecrets', connectionId).then(
                        () => undefined,
                    ),
            }),
            [connectionId],
        );
    }
    function usePluginAccount(requested: string): UsePluginAccountReturn {
        ownPlugin(requested);
        const connections = context().providerConnections as
            UsePluginAccountReturn['connections'] | undefined;
        const methods = useMemo(
            () => ({
                openConnection: (id: string, source?: string) =>
                    call('provider.openConnection', id, source).then(() => undefined),
                callConnection: <T,>(
                    id: string,
                    method: string,
                    args: Record<string, unknown> = {},
                ) => call('provider.accountConnection', id, method, args) as Promise<T>,
                prepare: <T,>(method: string, args: Record<string, unknown> = {}) =>
                    call('provider.account', 'prepare', method, args) as Promise<T>,
                connect: (secrets: Record<string, string>) =>
                    call('provider.account', 'connect', secrets).then(() => undefined),
                secretFields: () => call('provider.account', 'fields') as Promise<string[]>,
                disconnect: () => call('provider.account', 'disconnect').then(() => undefined),
                call: <T,>(method: string, args: Record<string, unknown> = {}) =>
                    call('provider.account', 'call', method, args) as Promise<T>,
                importConnection: (args: Record<string, unknown>) =>
                    call('provider.account', 'import', args) as ReturnType<
                        UsePluginAccountReturn['importConnection']
                    >,
            }),
            [],
        );
        return useMemo(
            () => ({...methods, connections: connections ?? []}),
            [methods, connections],
        );
    }
    function usePluginWorkspace(requested: string) {
        ownPlugin(requested);
        const connectionId = context().connectionId;
        const openWorkspace = useCallback(
            (options: OpenPluginWorkspaceOptions) => {
                if (
                    !connectionId ||
                    (options.connectionId && options.connectionId !== connectionId) ||
                    context().driver !== pluginId
                )
                    throw new Error('Select the workspace connection before opening it');
                if (!options.id.trim() || !options.title.trim())
                    throw new Error('Workspace ID and title are required');
                const key = JSON.stringify([connectionId, options.id]);
                const reservation =
                    reservations.get(key) ?? `plugin-workspace-${crypto.randomUUID()}`;
                reservations.set(key, reservation);
                void call('provider.openWorkspace', {...options, connectionId}).catch(report);
                return reservation;
            },
            [connectionId],
        );
        return useMemo(() => ({openWorkspace}), [openWorkspace]);
    }
    function GuestExplorerSection({
        pluginId: requested,
        providerName,
        connectionId,
        icon,
        items,
        disabled,
    }: PluginExplorerSectionProps) {
        const [open, setOpen] = useState(true);
        const workspace = usePluginWorkspace(requested);
        return (
            <Accordion
                title={providerName}
                isOpen={open}
                onToggle={() => setOpen((value) => !value)}
                actions={icon}
            >
                {items.map((item) => {
                    const Icon = getPluginExplorerIcon(item.icon);
                    return (
                        <button
                            key={item.id}
                            type="button"
                            aria-pressed={context().activeWorkspaceId === item.id}
                            disabled={disabled || !context().connectionId}
                            onClick={() =>
                                workspace.openWorkspace({
                                    id: item.id,
                                    title: `${providerName} · ${item.label}`,
                                    connectionId,
                                })
                            }
                            className="flex w-full cursor-pointer items-center gap-2 py-1 pl-8 pr-3 text-left text-xs text-secondary hover:bg-surface-secondary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                        >
                            <Icon size={14} className="shrink-0 text-muted" aria-hidden="true" />
                            <span className="truncate">{item.label}</span>
                        </button>
                    );
                })}
            </Accordion>
        );
    }
    function NativeComponent({
        kind,
        data,
        onEvent,
        height,
    }: {
        kind: 'codeEditor' | 'dataGrid';
        data: Record<string, unknown>;
        onEvent: (event: string, value: unknown) => void;
        height: number | string;
    }) {
        const id = useId();
        const element = useRef<HTMLDivElement>(null);
        const eventRef = useRef(onEvent);
        const edits = useRef(new Map<string, {generation: number; revision: number}>());
        const source = useRef({
            initialized: false,
            value: '',
            generation: 0,
            revision: 0,
            newestGeneration: 0,
            modelKey: '',
        });
        const dataKey = JSON.stringify(data);
        useLayoutEffect(() => {
            eventRef.current = onEvent;
        }, [onEvent]);
        useEffect(() => {
            nativeEvents.set(id, (event, value) => {
                if (
                    kind === 'codeEditor' &&
                    event === 'change' &&
                    value &&
                    typeof value === 'object' &&
                    'value' in value &&
                    typeof value.value === 'string' &&
                    'generation' in value &&
                    typeof value.generation === 'number' &&
                    Number.isSafeInteger(value.generation) &&
                    value.generation >= 0 &&
                    'revision' in value &&
                    typeof value.revision === 'number' &&
                    Number.isSafeInteger(value.revision) &&
                    value.revision >= 0
                ) {
                    if (value.generation < source.current.newestGeneration) return;
                    edits.current.set(value.value, {
                        generation: value.generation,
                        revision: value.revision,
                    });
                    eventRef.current(event, value.value);
                } else eventRef.current(event, value);
            });
            return () => {
                nativeEvents.delete(id);
                void call('ui.native.remove', id).catch(() => undefined);
            };
        }, [id, kind]);
        useLayoutEffect(() => {
            if (!element.current) return;
            const bounds = getPluginNativeBounds(element.current);
            const props = JSON.parse(dataKey) as Record<string, unknown>;
            let editorState;
            if (kind === 'codeEditor' && typeof props.value === 'string') {
                const modelKey = JSON.stringify([
                    props.language ?? 'javascript',
                    props.fileName ?? null,
                ]);
                const modelChanged =
                    source.current.initialized && source.current.modelKey !== modelKey;
                const echo = edits.current.get(props.value);
                if (modelChanged) {
                    // Monaco changes models when the filename/language changes. Seed the
                    // replacement with the current draft rather than its initial source.
                    source.current.generation = ++source.current.newestGeneration;
                    source.current.revision = 0;
                    edits.current.clear();
                } else if (echo) {
                    source.current.generation = echo.generation;
                    source.current.revision = echo.revision;
                    // Older echoes already carry their revision on the wire; forget settled
                    // values so an intentional reset to an earlier source remains possible.
                    for (const [value, edit] of edits.current) {
                        if (
                            edit.generation < echo.generation ||
                            (edit.generation === echo.generation && edit.revision <= echo.revision)
                        )
                            edits.current.delete(value);
                    }
                } else if (source.current.initialized && source.current.value !== props.value) {
                    source.current.generation = ++source.current.newestGeneration;
                    source.current.revision = 0;
                    edits.current.clear();
                }
                source.current.initialized = true;
                source.current.modelKey = modelKey;
                source.current.value = props.value;
                source.current.newestGeneration = Math.max(
                    source.current.newestGeneration,
                    source.current.generation,
                );
                editorState = {
                    generation: source.current.generation,
                    revision: source.current.revision,
                };
            }
            void call('ui.native.set', {
                id,
                kind,
                props,
                ...(editorState ? {editorState} : {}),
                ...bounds,
            }).catch(report);
        }, [dataKey, id, kind]);
        useEffect(() => {
            let stopped = false;
            let frame = 0;
            let previous = '';
            const update = () => {
                if (stopped) return;
                if (element.current) {
                    const bounds = getPluginNativeBounds(element.current);
                    const key = JSON.stringify(bounds);
                    if (key !== previous) {
                        previous = key;
                        void call('ui.native.bounds', id, bounds.rect, bounds.modal).catch(report);
                    }
                }
                frame = requestAnimationFrame(update);
            };
            frame = requestAnimationFrame(update);
            return () => {
                stopped = true;
                cancelAnimationFrame(frame);
            };
        }, [id]);
        return (
            <div
                ref={element}
                data-plugin-native={kind}
                style={{
                    height,
                    minHeight: kind === 'codeEditor' ? 240 : 96,
                    width: '100%',
                    minWidth: 0,
                }}
            />
        );
    }
    function GuestCodeEditor({onChange, onDiagnostics, ...props}: PluginCodeEditorProps) {
        return (
            <NativeComponent
                kind="codeEditor"
                data={props}
                height="100%"
                onEvent={(event, value) => {
                    if (event === 'change' && typeof value === 'string') onChange(value);
                    if (event === 'diagnostics' && Array.isArray(value))
                        onDiagnostics?.(
                            value as Parameters<
                                NonNullable<PluginCodeEditorProps['onDiagnostics']>
                            >[0],
                        );
                }}
            />
        );
    }
    function GuestDataGrid(props: PluginDataGridProps) {
        return (
            <NativeComponent
                kind="dataGrid"
                data={{...props}}
                height={
                    props.fill ? '100%' : Math.min(320, Math.max(96, (props.rows.length + 2) * 35))
                }
                onEvent={() => undefined}
            />
        );
    }
    function GuestSelect(props: PluginSelectProps) {
        const id = useId();
        const onOpenChange = useCallback(
            (open: boolean) => {
                void call('ui.popover', id, open).catch(report);
            },
            [id],
        );
        return (
            <I18nextProvider i18n={i18n}>
                <PluginSelect {...props} onOpenChange={onOpenChange} />
            </I18nextProvider>
        );
    }
    return {
        api: {
            usePluginEvent,
            publishPluginEvent: (requested: string, name: string, detail: unknown) => {
                ownPlugin(requested);
                return call('api.event.publish', name, detail).then(() => undefined);
            },
            usePluginRpc,
            usePluginAccount,
            usePluginWorkspace,
            copyText: (text: string) => call('api.copyText', text).then(() => undefined),
            PluginConnectionAction,
            PluginWorkspaceShell,
            PluginResourceList,
            PluginSelect: GuestSelect,
            PluginExplorerSection: GuestExplorerSection,
            PluginCodeEditor: GuestCodeEditor,
            PluginDataGrid: GuestDataGrid,
        },
        nativeEvent: (id: string, event: string, value: unknown) =>
            nativeEvents.get(id)?.(event, value),
        pluginEvent: (name: string, detail: unknown) => {
            for (const listener of pluginEvents.get(name) ?? []) {
                try {
                    listener(detail);
                } catch (error) {
                    report(error);
                }
            }
        },
        updateContext: (value: GuestContext) => {
            if (value.commonTranslations && typeof value.commonTranslations === 'object')
                i18n.addResourceBundle(
                    'en',
                    'translation',
                    {common: value.commonTranslations},
                    true,
                    true,
                );
        },
    };
}
