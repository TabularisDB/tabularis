import {useState} from 'react';
import {PluginConnectionAction, usePluginConnection, usePluginTranslation, usePluginWorkspace, type SlotComponentProps} from '@tabularis/plugin-api';
import {styles} from './styles';
import {NeonMark} from './NeonMark';

export default function NeonActions({context}: SlotComponentProps) {
  const t = usePluginTranslation('neon');
  if (context.targetPluginId && context.targetPluginId !== 'neon') return null;
  if (!context.targetPluginId && context.driver !== 'neon') return null;
  if (typeof usePluginWorkspace !== 'function' || typeof PluginConnectionAction !== 'function') return <p role="status">{t('coreRequired')}</p>;
  return <NeonWorkspaceAction context={context} />;
}

function NeonWorkspaceAction({context}: Pick<SlotComponentProps, 'context'>) {
  const t = usePluginTranslation('neon');
  const active = usePluginConnection();
  const {openWorkspace} = usePluginWorkspace('neon');
  const [error, setError] = useState<string>();
  const connectionId = context.connectionId ?? (active.driver === 'neon' ? active.connectionId : null);
  return <>
    <style>{styles}</style>
    <PluginConnectionAction
      providerName="Neon"
      label={t('open')}
      description={connectionId ? t('projectServices') : t('selectConnection')}
      brandColor="#00e599"
      disabled={!connectionId}
      icon={<NeonMark />}
      onClick={() => {
        if (!connectionId) return;
        try { openWorkspace({id:'services',title:'Neon',connectionId}); setError(undefined); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t('requestFailed')); }
      }}
    />
    {error && <p className="neon-error" role="alert">{error}</p>}
  </>;
}
