import {usePluginTranslation,type SlotComponentProps} from '@tabularis/plugin-api';
import {NeonPanel} from './NeonPanel';
import {serviceIds} from './services';

export default function NeonWorkspace({context}: SlotComponentProps) {
  const t = usePluginTranslation('neon');
  if (context.driver !== 'neon') return null;
  const serviceId = context.workspaceId === 'services' ? 'overview' : serviceIds.find(id => id === context.workspaceId);
  if (!serviceId) return <p role="status">{t('unknownService')}</p>;
  return <NeonPanel serviceId={serviceId}
    connectionId={typeof context.connectionId === 'string' ? context.connectionId : null}
    connectionName={typeof context.connectionName === 'string' ? context.connectionName : undefined}
  />;
}
