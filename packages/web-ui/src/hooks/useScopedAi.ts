import {useContext} from 'react';
import {ScopedAiContext} from '@/contexts/ScopedAiContext';
export const useScopedAi = () => useContext(ScopedAiContext);
