import {useCallback, useEffect, useRef, useState} from 'react';

export function useTask<T>() {
    const [data, setData] = useState<T>();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();
    const epoch = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            epoch.current += 1;
        };
    }, []);
    const run = useCallback(async (operation: () => Promise<T>): Promise<T | undefined> => {
        if (!mounted.current) return undefined;
        const request = ++epoch.current;
        setPending(true);
        setError(undefined);
        setData(undefined);
        try {
            const result = await operation();
            if (!mounted.current || request !== epoch.current) return undefined;
            setData(result);
            return result;
        } catch (cause) {
            if (mounted.current && request === epoch.current)
                setError(cause instanceof Error ? cause.message : 'Request failed');
            return undefined;
        } finally {
            if (mounted.current && request === epoch.current) setPending(false);
        }
    }, []);
    return {data, pending, error, run};
}
