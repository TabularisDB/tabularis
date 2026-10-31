/**
 * @tabularis/plugin-api
 *
 * Public API surface for plugin UI extensions.
 * Plugin components import these hooks to interact with the host application.
 */

// Plugin hooks
export {
    usePluginQuery,
    usePluginConnection,
    usePluginToast,
    usePluginSetting,
    usePluginModal,
    usePluginTheme,
    usePluginTranslation,
    openUrl,
    copyText,
} from './hooks/usePluginApi';

export {usePluginRpc} from './hooks/usePluginRpc';
export type {UsePluginRpcReturn} from './types/pluginRpc';

// Types
export type {SlotComponentProps, SlotContext, SlotName} from './types/pluginSlots';
export type {PluginModalOptions} from './contexts/PluginModalContext';

export {API_VERSION} from './pluginApiVersion';

// Slot registration helper — must be exposed via __TABULARIS_API__ so plugin
// IIFE bundles that externalize @tabularis/plugin-api can call defineSlot().
export function defineSlot(
    slot: string,
    component: unknown,
): {readonly __slot: string; readonly component: unknown} {
    return {__slot: slot, component} as const;
}

export {PluginConnectionAction} from './components/plugins/PluginConnectionAction';
export type {PluginConnectionActionProps} from './types/pluginWorkspace';

export {usePluginWorkspace} from './hooks/usePluginWorkspace';
export type {
    OpenPluginWorkspaceOptions,
    UsePluginWorkspaceReturn,
} from './types/pluginWorkspaceTab';
export {PluginWorkspaceShell} from './components/plugins/PluginWorkspaceShell';
export type {PluginWorkspaceShellProps} from './types/pluginWorkspaceShell';

export {PluginExplorerSection} from './components/plugins/PluginExplorerSection';
export type {PluginExplorerSectionProps} from './types/pluginExplorerSection';
export {PluginDataGrid} from './components/plugins/PluginDataGrid';
export {PluginResourceList} from './components/plugins/PluginResourceList';
export {PluginCodeEditor} from './components/plugins/PluginCodeEditor';
export type {PluginResourceListProps, PluginCodeEditorProps} from './types/pluginResources';
export type {PluginDataGridProps} from './types/pluginDataGrid';

export {usePluginAccount} from './hooks/usePluginAccount';
export type {UsePluginAccountReturn, PluginAccountImportResult} from './types/pluginAccount';
