import {useCallback, useEffect, useRef, useState} from 'react';
import {usePluginRpc} from '@tabularis/plugin-api';

interface ReadState<T> {
    key: string;
    pending: boolean;
    data?: T;
    error?: string;
}

/** Saved connection scope owns reads; changing a user/search invalidates older results. */
export function useAuthRead<T>(
    connectionId: string,
    method: string,
    args: Record<string, string | number>,
) {
    const {call} = usePluginRpc('neon', connectionId);
    const key = JSON.stringify([connectionId, method, args]);
    const [revision, setRevision] = useState(0);
    const [state, setState] = useState<ReadState<T>>({key, pending: true});
    const sequence = useRef(0);
    useEffect(() => {
        const request = ++sequence.current;
        let disposed = false;
        void Promise.resolve().then(async () => {
            if (disposed) return;
            setState((previous) => ({
                key,
                pending: true,
                data: previous.key === key ? previous.data : undefined,
            }));
            try {
                const data = await call<T>(
                    method,
                    JSON.parse(key)[2] as Record<string, string | number>,
                );
                if (!disposed && sequence.current === request)
                    setState({key, pending: false, data});
            } catch (error) {
                if (!disposed && sequence.current === request)
                    setState((previous) => ({
                        ...previous,
                        key,
                        pending: false,
                        error: error instanceof Error ? error.message : 'Request failed',
                    }));
            }
        });
        return () => {
            disposed = true;
            sequence.current += 1;
        };
    }, [call, key, method, revision]);
    const reload = useCallback(() => setRevision((value) => value + 1), []);
    return {
        data: state.key === key ? state.data : undefined,
        error: state.key === key ? state.error : undefined,
        pending: state.key !== key || state.pending,
        reload,
    };
}
