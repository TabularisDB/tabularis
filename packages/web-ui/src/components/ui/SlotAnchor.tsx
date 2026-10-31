import {useContext, useMemo} from 'react';
import type {ReactNode} from 'react';

import {PluginSlotContext} from '@/contexts/PluginSlotContext';
import {SlotErrorBoundary} from './SlotErrorBoundary';
import type {SlotName, SlotAnchorContext} from '@/types/pluginSlots';

interface SlotAnchorProps<S extends SlotName> {
    /** The slot location name */
    name: S;
    /** Context data provided to slot components (keys required for known slots) */
    context: SlotAnchorContext<S>;
    /** Optional CSS class for the wrapper div (only rendered when contributions exist) */
    className?: string;
    /** Limit this anchor to contributions owned by one plugin. */
    pluginId?: string;
    /** Content shown when no matching contribution is available. */
    fallback?: ReactNode;
}

/**
 * Host component that renders plugin contributions for a given slot.
 * Place this at each extension point in the UI.
 * Renders nothing when no contributions are registered.
 */
export const SlotAnchor = <S extends SlotName>({
    name,
    context,
    className,
    pluginId,
    fallback,
}: SlotAnchorProps<S>) => {
    const registry = useContext(PluginSlotContext);

    const contributions = useMemo(() => {
        if (!registry) return [];
        return registry
            .getSlotContributions(name, context)
            .filter((contribution) => !pluginId || contribution.pluginId === pluginId);
    }, [registry, name, context, pluginId]);

    if (contributions.length === 0) return fallback ?? null;

    return (
        <div className={className} data-slot={name}>
            {contributions.map((contribution, index) => {
                const Component = contribution.component;
                return (
                    <SlotErrorBoundary
                        key={`${contribution.pluginId}-${index}`}
                        pluginId={contribution.pluginId}
                        slotName={name}
                    >
                        <Component context={context} pluginId={contribution.pluginId} />
                    </SlotErrorBoundary>
                );
            })}
        </div>
    );
};
