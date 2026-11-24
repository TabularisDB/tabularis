import {createContext} from 'react';
import type {SessionNegotiation} from '@/api/session';

export const WebSessionContext = createContext<SessionNegotiation | null>(null);
