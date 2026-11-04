import {createElement} from 'react';
import {getHost} from './host';
import type {
    PluginConnectionActionProps,
    PluginWorkspaceShellProps,
    PluginExplorerSectionProps,
    PluginDataGridProps,
    PluginResourceListProps,
    PluginCodeEditorProps,
    PluginSelectProps,
} from './types';

/** A prominent, accessible provider action styled by the host. */
export function PluginConnectionAction(props: PluginConnectionActionProps) {
    return createElement(getHost().PluginConnectionAction, props);
}

/** Host layout for full-height provider workspaces. */
export function PluginWorkspaceShell(props: PluginWorkspaceShellProps) {
    return createElement(getHost().PluginWorkspaceShell, props);
}

/** Native Explorer section opening each service in its own main editor tab. */
export function PluginExplorerSection(props: PluginExplorerSectionProps) {
    return createElement(getHost().PluginExplorerSection, props);
}

/** Native read-only data results with host copy and resizing behavior. */
export function PluginDataGrid(props: PluginDataGridProps) {
    return createElement(getHost().PluginDataGrid, props);
}

/** Ordinary host resource navigation for provider-owned lists. */
export function PluginResourceList(props: PluginResourceListProps) {
    return createElement(getHost().PluginResourceList, props);
}

/** The host's themed Monaco editor for non-SQL source and configuration. */
export function PluginCodeEditor(props: PluginCodeEditorProps) {
    return createElement(getHost().PluginCodeEditor, props);
}

/** Host-themed native selection for provider forms. */
export function PluginSelect(props: PluginSelectProps) {
    return createElement(getHost().PluginSelect, props);
}
