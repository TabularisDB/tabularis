import {useState} from 'react';
import {PluginExplorerSection, usePluginConnection, usePluginTranslation, usePluginWorkspace, type SlotComponentProps} from '@tabularis/plugin-api';
import {styles} from './styles';
import {NeonMark} from './NeonMark';
import {serviceIds,serviceIcons} from './services';

export default function NeonActions({context}: SlotComponentProps) {
  const t = usePluginTranslation('neon');
  if (context.targetPluginId && context.targetPluginId !== 'neon') return null;
  if (!context.targetPluginId && context.driver !== 'neon') return null;
  if (typeof usePluginWorkspace !== 'function' || typeof PluginExplorerSection !== 'function') return <p role="status">{t('coreRequired')}</p>;
  return context.targetPluginId ? <NeonSettingsAction /> : <PluginExplorerSection
    pluginId="neon"
    providerName="Neon"
    connectionId={typeof context.connectionId === 'string' ? context.connectionId : undefined}
    icon={<NeonMark size={14} />}
    items={serviceIds.map(id => ({id:id === 'overview' ? 'services' : id,label:t(`tabs.${id}`),icon:serviceIcons[id]}))}
  />;
}

function NeonSettingsAction() {
  const t = usePluginTranslation('neon');
  const active = usePluginConnection();
  const {openWorkspace} = usePluginWorkspace('neon');
  const [error,setError] = useState<string>();
  const connectionId = active.driver === 'neon' ? active.connectionId : null;
  return <>
    <style>{styles}</style>
    <button type="button" className="neon-settings-action" disabled={!connectionId} onClick={() => {
      if (!connectionId) return;
      try { openWorkspace({id:'services',title:`Neon · ${t('tabs.overview')}`,connectionId});setError(undefined); }
      catch(cause) { setError(cause instanceof Error ? cause.message : t('requestFailed')); }
    }}><NeonMark size={16} />{t('manage')}</button>
    {!connectionId && <p>{t('selectConnection')}</p>}
    {error && <p className="neon-error" role="alert">{error}</p>}
  </>;
}
