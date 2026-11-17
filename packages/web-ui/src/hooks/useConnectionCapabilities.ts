import {useContext} from 'react';
import {ConnectionCapabilitiesContext} from '@/contexts/ConnectionCapabilitiesContext';

/** What the session may do with connections; unrestricted outside managed mode. */
export function useConnectionCapabilities() {
    return useContext(ConnectionCapabilitiesContext);
}
