import type {ReactNode} from 'react';
import type {SessionNegotiation} from '@/api/session';
import {WebSessionContext} from '@/contexts/webSession';

interface WebSessionProviderProps {
    readonly session: SessionNegotiation | null;
    readonly children: ReactNode;
}

/** Browser session negotiated at bootstrap; null on the trusted desktop shell. */
export function WebSessionProvider({session, children}: WebSessionProviderProps) {
    return <WebSessionContext.Provider value={session}>{children}</WebSessionContext.Provider>;
}
