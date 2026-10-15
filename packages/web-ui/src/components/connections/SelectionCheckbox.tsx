import { Check } from 'lucide-react';
import clsx from 'clsx';

interface SelectionCheckboxProps {
  selected: boolean;
  /** Keeps the box visible while any connection is selected. */
  selectionActive: boolean;
  onToggle: () => void;
  className?: string;
}

/** Multi-select checkbox shared by the grid card and the list row; swallows pointer events so the card does not react. */
export const SelectionCheckbox = ({ selected, selectionActive, onToggle, className }: SelectionCheckboxProps) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    onMouseDown={(e) => e.stopPropagation()}
    onDoubleClick={(e) => e.stopPropagation()}
    aria-pressed={selected}
    className={clsx(
      'w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-all duration-150',
      selected
        ? 'bg-accent-primary border-accent-primary text-inverse opacity-100'
        : clsx(
            'bg-elevated/90 border-strong text-transparent hover:border-accent-primary/70',
            selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          ),
      className,
    )}
  >
    <Check size={12} />
  </button>
);
