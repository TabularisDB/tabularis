import {useContext} from 'react';
import {useTranslation} from 'react-i18next';
import {SettingsContext} from '@/contexts/SettingsContext';
import {SlotAnchor} from '@/components/ui/SlotAnchor';
import type {Tab} from '@/types/editor';

interface PluginWorkspaceViewProps {
    tab: Tab;
    driver: string | null;
    schema: string | null;
    connectionName?: string | null;
}

export function PluginWorkspaceView({
    tab,
    driver,
    schema,
    connectionName,
}: PluginWorkspaceViewProps) {
    const {t} = useTranslation();
    const settings = useContext(SettingsContext);
    const unavailable = (
        <div
            role="status"
            className="flex flex-1 items-center justify-center p-8 text-center text-secondary"
        >
            {t('pluginWorkspace.unavailable')}
        </div>
    );
    if (
        !tab.pluginId ||
        !tab.workspaceId ||
        !settings?.settings.activeExternalDrivers?.includes(tab.pluginId)
    )
        return unavailable;
    return (
        <SlotAnchor
            name="editor.workspace.content"
            pluginId={tab.pluginId}
            context={{
                pluginId: tab.pluginId,
                workspaceId: tab.workspaceId,
                connectionId: tab.connectionId,
                driver,
                schema,
                connectionName,
            }}
            className="flex flex-1 flex-col min-h-0 overflow-hidden"
            fallback={unavailable}
        />
    );
}
