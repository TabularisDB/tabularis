import {useCallback} from 'react';
import {useDatabase} from './useDatabase';
import {useDangerousQueryGuard, type PendingDangerousQuery} from './useDangerousQueryGuard';
import {useProductionGuard} from './useProductionGuard';
import {isProductionConnection} from '@/utils/environment';
import {passQueryGuards} from '@/utils/queryGuard';

interface QueryGuards {
    pending: PendingDangerousQuery | null;
    isPending: boolean;
    guardQuery: (sqlOrQueries: string | string[], signal?: AbortSignal) => Promise<boolean>;
    resolve: (confirmed: boolean) => void;
}

/**
 * Composes production and dangerous-query confirmations into one ordered gate.
 * On production connections, the production prompt replaces the standard
 * dangerous-query prompt so a write never displays two confirmations.
 */
export function useQueryGuards(connectionId: string | null | undefined): QueryGuards {
    const {connections} = useDatabase();
    const isProduction = isProductionConnection(connections, connectionId);
    const {
        pending,
        isPending,
        guardQuery: guardDangerousQuery,
        resolve,
    } = useDangerousQueryGuard(!isProduction);
    const guardProductionWrite = useProductionGuard();

    const guardQuery = useCallback(
        (sqlOrQueries: string | string[], signal?: AbortSignal) => {
            const productionSql = Array.isArray(sqlOrQueries)
                ? sqlOrQueries.join(';\n')
                : sqlOrQueries;

            return passQueryGuards({
                guardProduction: () =>
                    signal
                        ? guardProductionWrite(connectionId, productionSql, signal)
                        : guardProductionWrite(connectionId, productionSql),
                guardDangerousQuery: () =>
                    signal?.aborted ? Promise.resolve(false) : guardDangerousQuery(sqlOrQueries),
            });
        },
        [connectionId, guardDangerousQuery, guardProductionWrite],
    );

    return {pending, isPending, guardQuery, resolve};
}
