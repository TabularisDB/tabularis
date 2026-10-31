import {createElement} from 'react';
import {getHost} from './host';
import type {
    PluginConnectionActionProps,
    PluginWorkspaceShellProps,
    PluginExplorerSectionProps,
    PluginDataGridProps,
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
