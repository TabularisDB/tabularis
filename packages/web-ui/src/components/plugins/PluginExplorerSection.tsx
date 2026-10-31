import {useState} from 'react';
import {
    Activity,
    Brain,
    Database,
    FileText,
    Folder,
    LayoutDashboard,
    Settings,
    Shield,
    Users,
    Zap,
} from 'lucide-react';
import {Accordion} from '@/components/layout/sidebar/Accordion';
import {useEditor} from '@/hooks/useEditor';
import {usePluginConnection} from '@/hooks/usePluginApi';
import {usePluginWorkspace} from '@/hooks/usePluginWorkspace';
import type {PluginExplorerSectionProps} from '@/types/pluginExplorerSection';

const itemIcons = {
    overview: LayoutDashboard,
    database: Database,
    users: Users,
    storage: Folder,
    functions: Zap,
    ai: Brain,
    realtime: Activity,
    settings: Settings,
    documents: FileText,
    security: Shield,
};

export function PluginExplorerSection({
    pluginId,
    providerName,
    connectionId,
    icon,
    items,
    disabled,
}: PluginExplorerSectionProps) {
    const [isOpen, setIsOpen] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const {connectionId: currentConnectionId} = usePluginConnection();
    const {activeTab} = useEditor();
    const {openWorkspace} = usePluginWorkspace(pluginId);
    const targetConnectionId = connectionId ?? currentConnectionId;
    return (
        <Accordion
            title={providerName}
            isOpen={isOpen}
            onToggle={() => setIsOpen((open) => !open)}
            actions={
                icon && (
                    <span
                        className="flex h-4 w-4 items-center justify-center text-muted [&>svg]:h-3.5 [&>svg]:w-3.5"
                        aria-hidden="true"
                    >
                        {icon}
                    </span>
                )
            }
        >
            {items.map((item) => {
                const Icon =
                    item.icon && Object.hasOwn(itemIcons, item.icon)
                        ? itemIcons[item.icon as keyof typeof itemIcons]
                        : FileText;
                const selected =
                    activeTab?.type === 'plugin-workspace' &&
                    activeTab.pluginId === pluginId &&
                    activeTab.workspaceId === item.id &&
                    activeTab.connectionId === targetConnectionId;
                return (
                    <button
                        key={item.id}
                        type="button"
                        aria-pressed={selected}
                        disabled={disabled || !targetConnectionId}
                        onClick={() => {
                            try {
                                openWorkspace({
                                    id: item.id,
                                    title: `${providerName} · ${item.label}`,
                                    connectionId: targetConnectionId ?? undefined,
                                });
                                setError(null);
                            } catch (cause) {
                                setError(cause instanceof Error ? cause.message : String(cause));
                            }
                        }}
                        className={`flex w-full cursor-pointer disabled:cursor-default items-center gap-2 py-1 pl-8 pr-3 text-left text-xs transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${selected ? 'bg-surface-active text-primary' : 'text-secondary hover:bg-surface-secondary hover:text-primary'}`}
                    >
                        <Icon size={14} className="shrink-0 text-muted" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                    </button>
                );
            })}
            {error && (
                <p role="alert" className="px-3 py-1 text-xs text-accent-error">
                    {error}
                </p>
            )}
        </Accordion>
    );
}
