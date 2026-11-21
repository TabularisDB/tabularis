import {useEffect, useState} from 'react';
import {useTabularisClient} from './useTabularisClient';

interface SupportState {
    connectionId: string;
    supported: boolean;
}

/** Whether the connection's driver can record and restore saved grid edits. */
export function useSaveHistorySupport(connectionId: string | null | undefined): boolean {
    const client = useTabularisClient();
    const [state, setState] = useState<SupportState | null>(null);

    useEffect(() => {
        if (!connectionId) return;
        let cancelled = false;
        client
            .call('get_save_history_status', {connectionId})
            .then((status) => {
                if (!cancelled) setState({connectionId, supported: status.supported});
            })
            .catch(() => {
                if (!cancelled) setState({connectionId, supported: false});
            });
        return () => {
            cancelled = true;
        };
    }, [client, connectionId]);

    return !!connectionId && state?.connectionId === connectionId && state.supported;
}
