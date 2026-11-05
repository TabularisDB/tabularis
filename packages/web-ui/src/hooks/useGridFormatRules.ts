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

    /** Writes the table's rules to the backend first, so a failed save can be reported. */
    const saveRules = useCallback(
        async (next: readonly FormatRule[]): Promise<void> => {
            if (!connectionId || !scope) return;
            await store.commit(
                UI_STATE_KEYS.gridFormatRules.key,
                setTableFormatRules(all, connectionId, scope, next),
            );
        },
        [all, connectionId, scope, store],
    );

    return {rules, saveRules, available: Boolean(connectionId && scope)};
}
