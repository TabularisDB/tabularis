/**
 * @tabularis/plugin-api
 *
 * Public API surface for Tabularis plugin UI extensions.
 * Plugin bundles import hooks and the `defineSlot` helper from this package;
 * the Tabularis host injects the runtime implementation at load time.
 */

export {
    usePluginQuery,
    usePluginRpc,
    usePluginAccount,
    usePluginWorkspace,
    usePluginConnection,
    usePluginToast,
    usePluginSetting,
    usePluginTranslation,
    usePluginModal,
    usePluginTheme,
    openUrl,
    copyText,
} from './hooks';

export {getHost, assertHostCompat} from './host';

export {API_VERSION, MIN_HOST_VERSION} from './version';

export {defineSlot} from './slots';

export type {
    SlotName,
    SlotContext,
    SlotComponentProps,
    SlotContextMap,
    PluginSecretFieldState,
    TypedSlotProps,
    UIExtensionDeclaration,
} from './slots';

export type {
    PluginModalOptions,
    PluginConfig,
    ThemeColors,
    PluginQueryResult,
    PluginTranslator,
    TabularisHostApi,
    UsePluginQueryReturn,
    UsePluginRpcReturn,
    UsePluginAccountReturn,
    PluginAccountImportResult,
    UsePluginConnectionReturn,
    UsePluginToastReturn,
    UsePluginSettingReturn,
    UsePluginModalReturn,
    UsePluginThemeReturn,
} from './types';

export {
    PluginConnectionAction,
    PluginWorkspaceShell,
    PluginExplorerSection,
    PluginDataGrid,
    PluginResourceList,
    PluginCodeEditor,
} from './components';
export type {
    PluginConnectionActionProps,
    PluginExplorerSectionProps,
    PluginDataGridProps,
    PluginResourceListProps,
    PluginCodeEditorProps,
    PluginWorkspaceShellProps,
    OpenPluginWorkspaceOptions,
    UsePluginWorkspaceReturn,
} from './types';
