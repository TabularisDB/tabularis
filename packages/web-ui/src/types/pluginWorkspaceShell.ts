import type {ReactNode} from 'react';

/** Shared provider workspace chrome; each plugin supplies its own sections and content. */
export interface PluginWorkspaceShellProps {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    brandColor?: string;
    tabs: ReadonlyArray<{id: string; label: string; icon?: ReactNode}>;
    activeTab: string;
    onTabChange: (id: string) => void;
    children: ReactNode;
    actions?: ReactNode;
}
