import {useEffect, useState} from 'react';
import type {TableTransferCapabilities} from '@/api/contract';
import {useTabularisClient} from './useTabularisClient';

/** Driver pairs the backend can transfer between; null until it answers. */
export function useTableTransferCapabilities(): TableTransferCapabilities | null {
    const client = useTabularisClient();
    const [capabilities, setCapabilities] = useState<TableTransferCapabilities | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const result = await client.call('get_table_transfer_capabilities', undefined);
                if (!cancelled && result) setCapabilities(result);
            } catch (error) {
                console.error('Failed to load table transfer capabilities:', error);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [client]);

    return capabilities;
}
