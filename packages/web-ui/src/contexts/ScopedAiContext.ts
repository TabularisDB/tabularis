import {createContext} from 'react';
import type {SessionNegotiation} from '@/api/session';
export const ScopedAiContext = createContext<SessionNegotiation['scopedAi']>(undefined);
