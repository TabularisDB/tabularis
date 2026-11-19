import {createContext} from 'react';
import type {RegistryPluginWithStatus} from '@/types/plugins';

export interface PluginRegistryState {
    plugins: RegistryPluginWithStatus[];
    updates: RegistryPluginWithStatus[];
    loading: boolean;
    error: string | null;
    /** Resolves once the registry state reflects this refresh, or the newer one that replaced it. */
    refresh: () => Promise<void>;
}

export const PluginRegistryContext = createContext<PluginRegistryState | undefined>(undefined);
