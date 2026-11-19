import {useCallback, useRef, useState} from 'react';
import {classifyDangerousQuery, type DangerousQueryKind} from '@/utils/sqlAnalysis';

/** Details about the dangerous statement that triggered a confirmation. */
export interface DangerousQueryInfo {
    /** Why the statement was flagged — drives the dialog copy. */
    kind: DangerousQueryKind;
    /** The flagged statement itself, shown to the user as a preview. */
    sql: string;
    /** How many statements in the batch were flagged (>= 1). */
    count: number;
}

/** i18n key pairs for each danger kind, shared by every consumer of the guard. */
export const DANGEROUS_QUERY_I18N: Record<DangerousQueryKind, {title: string; message: string}> = {
    'no-where': {
        title: 'editor.dangerousQueryTitle',
        message: 'editor.dangerousQueryMessage',
    },
    drop: {
        title: 'editor.dangerousQueryDropTitle',
        message: 'editor.dangerousQueryDropMessage',
    },
    truncate: {
        title: 'editor.dangerousQueryTruncateTitle',
        message: 'editor.dangerousQueryTruncateMessage',
    },
};

interface QueuedConfirmation {
    info: DangerousQueryInfo;
    resolve: (confirmed: boolean) => void;
}

/**
 * Gates execution of dangerous statements (DELETE/UPDATE with no WHERE, DROP,
 * TRUNCATE) behind a user confirmation. `guardQuery` resolves immediately (no
 * dialog) for safe statements; for dangerous ones it opens the dialog and
 * resolves once the user answers. A second dangerous statement submitted while
 * a dialog is already open waits its turn, so neither caller is dropped or
 * left pending. Pass `false` to disable this guard when a higher-priority
 * safety prompt handles the action.
 */
export function useDangerousQueryGuard(enabled = true) {
    const [pending, setPending] = useState<DangerousQueryInfo | null>(null);
    const queueRef = useRef<QueuedConfirmation[]>([]);

    const requestConfirmation = useCallback((info: DangerousQueryInfo): Promise<boolean> => {
        return new Promise((resolve) => {
            queueRef.current.push({info, resolve});
            if (queueRef.current.length === 1) setPending(info);
        });
    }, []);

    const resolve = useCallback((confirmed: boolean) => {
        const current = queueRef.current.shift();
        current?.resolve(confirmed);
        setPending(queueRef.current[0]?.info ?? null);
    }, []);

    const guardQuery = useCallback(
        (sqlOrQueries: string | string[]): Promise<boolean> => {
            if (!enabled) return Promise.resolve(true);

            const statements = Array.isArray(sqlOrQueries) ? sqlOrQueries : [sqlOrQueries];

            let first: DangerousQueryInfo | null = null;
            let count = 0;
            for (const sql of statements) {
                const kind = classifyDangerousQuery(sql);
                if (!kind) continue;
                count++;
                if (!first) first = {kind, sql, count: 0};
            }

            if (!first) return Promise.resolve(true);
            return requestConfirmation({...first, count});
        },
        [enabled, requestConfirmation],
    );

    return {pending, isPending: pending !== null, guardQuery, resolve};
}
