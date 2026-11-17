import {createContext} from 'react';
import {STANDALONE_CONNECTION_CAPABILITIES, type ConnectionCapabilities} from '@/api/session';

export const ConnectionCapabilitiesContext = createContext<ConnectionCapabilities>(
    STANDALONE_CONNECTION_CAPABILITIES,
);
