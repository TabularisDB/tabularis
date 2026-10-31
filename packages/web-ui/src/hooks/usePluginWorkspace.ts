import {useCallback, useMemo} from 'react';
import {useEditor} from './useEditor';
import {usePluginConnection} from './usePluginApi';
import type {
    OpenPluginWorkspaceOptions,
    UsePluginWorkspaceReturn,
} from '@/types/pluginWorkspaceTab';

/** Open a connection-bound workspace in the host's main editor. */
export function usePluginWorkspace(pluginId: string): UsePluginWorkspaceReturn {
    const {addTab, tabs, setActiveTabId} = useEditor();
    const {connectionId: activeConnectionId} = usePluginConnection();
    const openWorkspace = useCallback(
        (options: OpenPluginWorkspaceOptions): string => {
            const connectionId = options.connectionId ?? activeConnectionId;
            if (!connectionId || connectionId !== activeConnectionId) {
                throw new Error('Select the workspace connection before opening it');
            }
            if (!pluginId.trim() || !options.id.trim() || !options.title.trim()) {
                throw new Error('Plugin workspace requires a plugin ID, workspace ID and title');
            }
            const existing = tabs.find(
                (tab) =>
                    tab.type === 'plugin-workspace' &&
                    tab.connectionId === connectionId &&
                    tab.pluginId === pluginId &&
                    tab.workspaceId === options.id,
            );
            if (existing) {
                setActiveTabId(existing.id);
                return existing.id;
            }
            const id = addTab({
                type: 'plugin-workspace',
                pluginId,
                workspaceId: options.id,
                title: options.title,
                connectionId,
            });
            if (!id) throw new Error('The workspace connection is not active in this editor');
            return id;
        },
        [activeConnectionId, addTab, pluginId, setActiveTabId, tabs],
    );
    return useMemo(() => ({openWorkspace}), [openWorkspace]);
}
