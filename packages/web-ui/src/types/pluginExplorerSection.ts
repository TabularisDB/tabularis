import type {ReactNode} from 'react';

/** Connection services rendered as native Explorer rows, each opening its own editor tab. */
export interface PluginExplorerSectionProps {
    pluginId: string;
    providerName: string;
    connectionId?: string;
    icon?: ReactNode;
    items: ReadonlyArray<{id: string; label: string; icon?: string}>;
    disabled?: boolean;
}
