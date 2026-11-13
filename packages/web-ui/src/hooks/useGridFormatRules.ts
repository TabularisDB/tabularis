import {useCallback, useMemo} from 'react';
import {useUiState} from '@/hooks/useUiState';
import {UI_STATE_KEYS, uiStateStore, type UiStateStore} from '@/utils/uiStateStore';
import {
    formatRulesScope,
    getTableFormatRules,
    sanitizeFormatRules,
    setTableFormatRules,
    type FormatRule,
} from '@/utils/conditionalFormatting';

const NO_RULES: unknown = {};
const EMPTY: FormatRule[] = [];

/**
 * Conditional formatting rules of one table (#991). Saved in the shared UI state,
 * so they survive restarts and apply in every window and browser session. Without
 * a connection or a table (query results) there are no rules.
 */
export function useGridFormatRules(
    connectionId: string | null | undefined,
    database: string | null | undefined,
    schema: string | null | undefined,
    table: string | null | undefined,
    {store = uiStateStore}: {store?: UiStateStore} = {},
) {
    const [stored] = useUiState<unknown>(UI_STATE_KEYS.gridFormatRules, NO_RULES, {store});
    const all = useMemo(() => sanitizeFormatRules(stored), [stored]);
    const scope = table ? formatRulesScope(database, schema, table) : null;

    const rules = connectionId && scope ? getTableFormatRules(all, connectionId, scope) : EMPTY;

    /**
     * Writes the table's rules to the backend first, so a failed save can be reported.
     * Only this table changes: the other tables' rules are taken from the store's
     * current value at save time, which follows the changes other windows saved.
     */
    const saveRules = useCallback(
        async (next: readonly FormatRule[]): Promise<void> => {
            if (!connectionId || !scope) return;
            const {key} = UI_STATE_KEYS.gridFormatRules;
            const current = sanitizeFormatRules(store.get<unknown>(key, NO_RULES));
            await store.commit(key, setTableFormatRules(current, connectionId, scope, next));
        },
        [connectionId, scope, store],
    );

    return {rules, saveRules, available: Boolean(connectionId && scope)};
}
