import {createContext, useCallback, useContext} from 'react';
import {useDatabase} from './useDatabase';
import {isReadOnlyQuery} from '@/utils/sqlAnalysis';
import {useTranslation} from 'react-i18next';
import {useAlert} from './useAlert';

/**
 * Connection write gate: read-only policy first, then production confirmation.
 *
 * `useProductionGuard()` returns `guardWrite(connectionId, sql?)`: it
 * refuses writes on a read-only connection regardless of snooze or provider.
 * Otherwise it resolves `true` immediately unless the connection is classified as
 * production AND the operation is (or may be) a write, in which case a
 * confirmation dialog is shown by `ProductionGuardProvider`. Ticking
 * "don't ask again" silences the prompt for that connection until the
 * app restarts.
 */

export type GuardRequest = (
    connectionId: string,
    connectionName: string,
    sql?: string,
) => Promise<boolean>;

export const ProductionGuardContext = createContext<GuardRequest | null>(null);

/** Session-scoped snooze; survives provider remounts, dies with the window. */
export const snoozedConnectionIds = new Set<string>();

export function useProductionGuard() {
    const {connections} = useDatabase();
    const request = useContext(ProductionGuardContext);
    const {t} = useTranslation();
    const {showAlert} = useAlert();

    return useCallback(
        async (connectionId: string | null | undefined, sql?: string): Promise<boolean> => {
            if (!connectionId) return true;
            const conn = connections.find((c) => c.id === connectionId);
            if (conn?.params.read_only && (sql === undefined || !isReadOnlyQuery(sql))) {
                showAlert(t('readOnly.writeBlocked'), {kind: 'warning'});
                return false;
            }
            if (conn?.environment !== 'production') return true;
            if (sql !== undefined && isReadOnlyQuery(sql)) return true;
            if (snoozedConnectionIds.has(connectionId)) return true;
            // No provider in this window: don't silently block the operation.
            if (!request) return true;
            return request(connectionId, conn.name, sql);
        },
        [connections, request, showAlert, t],
    );
}
