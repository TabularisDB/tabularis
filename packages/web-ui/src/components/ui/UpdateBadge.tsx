import { CountBadge } from "./CountBadge";

interface UpdateBadgeProps {
  count: number;
  /** Accessible name; the visible tooltip is provided by the parent. */
  tooltip: string;
  className?: string;
}

/**
 * Update counter shared by the sidebar rail and the settings navigation.
 * Always the `update` tone so core and plugin updates read as one concept;
 * the surrounding label (Info vs Plugins) tells which kind it counts.
 */
export function UpdateBadge({ count, tooltip, className }: UpdateBadgeProps) {
  return <CountBadge tone="update" count={count} aria-label={tooltip} className={className} />;
}
