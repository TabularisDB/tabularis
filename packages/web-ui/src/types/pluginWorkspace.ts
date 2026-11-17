import type {ReactNode} from 'react';

/** Host-rendered entry point for a provider's connection tools. */
export interface PluginConnectionActionProps {
    providerName: string;
    label: string;
    description?: string;
    icon?: ReactNode;
    brandColor?: string;
    disabled?: boolean;
    onClick: () => void;
}
