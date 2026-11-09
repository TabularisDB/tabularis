import {lazy, Suspense} from 'react';
import {useTranslation} from 'react-i18next';
import {useSettings} from '@/hooks/useSettings';
import type {PluginDataGridProps} from '@/types/pluginDataGrid';

const NativeDataGrid = lazy(() =>
    import('@/components/ui/DataGrid').then(({DataGrid}) => ({default: DataGrid})),
);

export function PluginDataGrid({columns, rows, connectionId, label, fill}: PluginDataGridProps) {
    const {settings} = useSettings();
    const {t} = useTranslation();
    const height = Math.min(320, Math.max(96, (rows.length + 2) * 35));
    return (
        <div
            role={label ? 'region' : undefined}
            aria-label={label}
            className="min-h-0 w-full min-w-0 overflow-hidden"
            style={{height: fill ? '100%' : height}}
        >
            <Suspense
                fallback={
                    <div
                        role="progressbar"
                        aria-label={label ?? t('common.loading')}
                        className="h-full bg-base"
                    />
                }
            >
                <NativeDataGrid
                    columns={columns}
                    data={rows}
                    connectionId={connectionId}
                    readonly
                    tableName={null}
                    copyFormat={settings.copyFormat}
                    csvDelimiter={settings.csvDelimiter}
                    csvIncludeHeaders={settings.csvIncludeHeaders}
                />
            </Suspense>
        </div>
    );
}
