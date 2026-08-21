import { useContext, useMemo } from "react";

import { PluginSlotContext } from "../../contexts/PluginSlotContext";
import { SlotErrorBoundary } from "./SlotErrorBoundary";
import type { SlotName, SlotContext } from "../../types/pluginSlots";

interface SlotAnchorProps {
  /** The slot location name */
  name: SlotName;
  /** Context data provided to slot components */
  context: SlotContext;
  /** Optional CSS class for the wrapper div (only rendered when contributions exist) */
  className?: string;
}

/**
 * Host component that renders plugin contributions for a given slot.
 * Place this at each extension point in the UI.
 * Renders nothing when no contributions are registered.
 */
export const SlotAnchor = ({ name, context, className }: SlotAnchorProps) => {
  const registry = useContext(PluginSlotContext);

  const contributions = useMemo(() => {
    if (!registry) return [];
    return registry.getSlotContributions(name, context);
  }, [registry, name, context]);

  if (contributions.length === 0) return null;

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
