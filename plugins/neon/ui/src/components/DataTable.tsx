import {
    PluginDataGrid,
    usePluginConnection,
    usePluginTranslation,
    type PluginQueryResult,
} from '@tabularis/plugin-api';

export function DataTable({data, fill}: {data: PluginQueryResult; fill?: boolean}) {
    const {connectionId} = usePluginConnection();
    const t = usePluginTranslation('neon');
    return (
        <PluginDataGrid
            columns={data.columns}
            rows={data.rows}
            connectionId={connectionId}
            label={t('gridLabel')}
            fill={fill}
        />
    );
}
