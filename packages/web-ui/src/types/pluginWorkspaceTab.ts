export interface OpenPluginWorkspaceOptions {
    /** Stable workspace identifier owned by the plugin. */
    id: string;
    title: string;
    /** Must match the active connection in both the slot and editor scopes. */
    connectionId?: string;
}

export interface UsePluginWorkspaceReturn {
    openWorkspace: (options: OpenPluginWorkspaceOptions) => string;
}
