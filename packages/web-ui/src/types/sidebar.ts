import type {SchemaObjectDetails} from './schemaObjectDetails';
import type {SavedQuery} from '@/contexts/SavedQueriesContext';
import type {RoutineInfo} from '@/contexts/DatabaseContext';
import type {QueryHistoryEntry} from './queryHistory';

export type ContextMenuData =
    | SavedQuery
    | {tableName: string; schema?: string; database?: string; objectDetails?: SchemaObjectDetails}
    | (RoutineInfo & {schema?: string; database?: string})
    | QueryHistoryEntry
    | {schema: string};
