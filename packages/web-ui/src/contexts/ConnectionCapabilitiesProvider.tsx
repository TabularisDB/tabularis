import type {ReactNode} from 'react';
import {resolveConnectionCapabilities, type SessionNegotiation} from '@/api/session';
import {ConnectionCapabilitiesContext} from './ConnectionCapabilitiesContext';

interface ConnectionCapabilitiesProviderProps {
    children: ReactNode;
    session: SessionNegotiation | null;
}

export function ConnectionCapabilitiesProvider({
    children,
    session,
}: ConnectionCapabilitiesProviderProps) {
    return (
        <ConnectionCapabilitiesContext.Provider value={resolveConnectionCapabilities(session)}>
            {children}
        </ConnectionCapabilitiesContext.Provider>
    );
}
