import {parseResource} from './utils/workspace';
import {usePluginTranslation, type SlotComponentProps} from '@tabularis/plugin-api';
import {NeonPanel} from './NeonPanel';
import {serviceIds} from './services';

export default function NeonWorkspace({context}: SlotComponentProps) {
    const t = usePluginTranslation('neon');
    if (context.driver !== 'neon') return null;
    const workspaceId = typeof context.workspaceId === 'string' ? context.workspaceId : '';
    const resource = parseResource(workspaceId);
    const serviceId = resource
        ? resource.service
        : workspaceId === 'services'
          ? 'overview'
          : workspaceId === 'database'
            ? 'database'
            : serviceIds.find((id) => id === workspaceId);
    if (!serviceId) return <p role="status">{t('unknownService')}</p>;
    return (
        <NeonPanel
            serviceId={serviceId}
            functionSlug={resource?.functionSlug}
            createFunction={resource?.createFunction}
            authUserId={resource?.authUserId}
            connectionId={typeof context.connectionId === 'string' ? context.connectionId : null}
            connectionName={
                typeof context.connectionName === 'string' ? context.connectionName : undefined
            }
        />
    );
}
