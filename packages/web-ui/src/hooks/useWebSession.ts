import {useContext} from 'react';
import type {SessionNegotiation} from '@/api/session';
import {WebSessionContext} from '@/contexts/webSession';

export function useWebSession(): SessionNegotiation | null {
    return useContext(WebSessionContext);
}
