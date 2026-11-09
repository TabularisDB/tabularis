import {useContext, useMemo} from 'react';
import {SettingsContext} from '@/contexts/SettingsContext';
import type {SchemaData} from '@/contexts/DatabaseContext';
import {getTableColumns} from '@/utils/autocomplete';
import {isSchemaBasedMultiDb} from '@/utils/database';
import {createRelationResolver} from '@/utils/sqlDiagnosticsMetadata';
import {useDatabase} from './useDatabase';
import {useTabularisClient} from './useTabularisClient';
import type {SqlDiagnosticsOptions} from './useSqlDiagnostics';

type Options = {
    schema?: string | null;
    /** The database the editor's tab is scoped to (nested multi-db). */
    database?: string | null;
    /** False while the editor is not the one being worked in. Defaults to true. */
    enabled?: boolean;
};

const relationNames = (data: Pick<SchemaData, 'tables' | 'views' | 'materializedViews'>) =>
    new Set(
        [...data.tables, ...data.views, ...(data.materializedViews ?? [])].map(
            (relation) => relation.name,
        ),
    );

/**
 * Builds the diagnostics context for the SQL editor of the active connection:
 * how a relation name resolves (search path, database) and where its columns
 * come from. Returns undefined, which disables diagnostics, unless the setting
 * is on and the driver is PostgreSQL, the only dialect analyzed so far.
 *
 * Only metadata the app already loaded is listed; columns are read per
 * relation a query names, through the bounded autocomplete cache.
 */
export function useSqlDiagnosticsOptions(
    connectionId: string | null,
    options?: Options,
): SqlDiagnosticsOptions | undefined {
    const client = useTabularisClient();
    const {
        tables,
        views,
        materializedViews,
        isLoadingTables,
        isLoadingViews,
        activeDriver,
        activeSchema,
        activeCapabilities,
        activeDatabaseName,
        schemaDataMap,
        nestedDatabaseDataMap,
        selectedDatabases,
    } = useDatabase();
    const settingsContext = useContext(SettingsContext);

    const settingEnabled = settingsContext?.settings.sqlDiagnosticsEnabled === true;
    const active = settingEnabled && (options?.enabled ?? true) && activeDriver === 'postgres';
    const schema = options?.schema ?? activeSchema;
    const tabDatabase = options?.database ?? null;
    const isNestedMultiDb = isSchemaBasedMultiDb(activeCapabilities, selectedDatabases);
    const database = isNestedMultiDb
        ? (tabDatabase ?? activeDatabaseName ?? selectedDatabases[0] ?? null)
        : null;

    return useMemo(() => {
        if (!active || !connectionId) return undefined;

        const searchPath = [...new Set([schema, 'public'].filter((s): s is string => !!s))];
        const listRelations = (target: string): ReadonlySet<string> | null => {
            const data = database
                ? nestedDatabaseDataMap[database]?.schemaDataMap[target]
                : schemaDataMap[target];
            if (data?.isLoaded) return relationNames(data);
            // The active schema's listing lives at the top level of the context.
            // An empty one is indistinguishable from "not loaded yet".
            if (!database && target === schema && !isLoadingTables && !isLoadingViews) {
                const names = relationNames({tables, views, materializedViews});
                return names.size > 0 ? names : null;
            }
            return null;
        };

        return {
            resolveRelation: createRelationResolver({
                searchPath,
                listRelations,
                fetchColumns: async (target, name) =>
                    (await getTableColumns(client, connectionId, name, target, database)).map(
                        (column) => column.label,
                    ),
            }),
        };
    }, [
        active,
        client,
        connectionId,
        database,
        isLoadingTables,
        isLoadingViews,
        materializedViews,
        nestedDatabaseDataMap,
        schema,
        schemaDataMap,
        tables,
        views,
    ]);
}
