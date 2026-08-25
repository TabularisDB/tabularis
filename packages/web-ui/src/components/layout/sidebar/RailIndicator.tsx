interface RailIndicatorProps {
  isActive: boolean;
  /** Extra positioning classes (e.g. "-left-2" when the parent is not full-width) */
  className?: string;
}

/**
 * Discord-style left indicator for items in the narrow sidebar rail:
 * full-height white pill when active, shorter pill revealed on hover.
 * The parent must be `relative` and carry the `group` class.
 */
export const RailIndicator = ({ isActive, className = "left-0" }: RailIndicatorProps) => (
  <div
    data-testid="rail-indicator"
    className={`absolute top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-white transition-all duration-200 pointer-events-none ${
      isActive ? "h-8 opacity-100" : "h-4 opacity-0 group-hover:opacity-100"
    } ${className}`}
  />
);
