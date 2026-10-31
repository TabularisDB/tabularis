import {PluginDataGrid,usePluginConnection,usePluginTranslation,type PluginQueryResult} from '@tabularis/plugin-api';

export function DataTable({data}:{data:PluginQueryResult}) {
  const {connectionId} = usePluginConnection();
  const t = usePluginTranslation('neon');
  return <PluginDataGrid columns={data.columns} rows={data.rows} connectionId={connectionId} label={t('gridLabel')} />;
}
