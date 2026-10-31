import {createElement} from 'react';
import {getHost} from './host';
import type {PluginConnectionActionProps, PluginWorkspaceShellProps} from './types';

/** A prominent, accessible provider action styled by the host. */
export function PluginConnectionAction(props: PluginConnectionActionProps) {
    return createElement(getHost().PluginConnectionAction, props);
}

/** Host layout for full-height provider workspaces. */
export function PluginWorkspaceShell(props: PluginWorkspaceShellProps) {
    return createElement(getHost().PluginWorkspaceShell, props);
}
