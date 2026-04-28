import { type ElementType, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

interface NavRowProps {
  to: string;
  icon: ElementType;
  label: string;
  badge?: ReactNode;
  isOnline?: boolean;
}

export const NavRow = ({ to, icon: Icon, label, badge, isOnline }: NavRowProps) => (
  <NavLink
    to={to}
    end
    className={({ isActive }) =>
      clsx(
        'group flex items-center gap-2 px-2 h-8 rounded-md transition-colors text-xs font-medium',
        isActive
          ? 'bg-surface-hover text-primary'
          : 'text-secondary hover:bg-surface-hover hover:text-primary',
      )
    }
  >
    <span className="relative shrink-0 flex items-center justify-center w-4 h-4">
      <Icon size={15} />
      {isOnline && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent-success border border-elevated" />
      )}
    </span>
    <span className="flex-1 truncate">{label}</span>
    {badge !== undefined && badge !== null && (
      <span className="text-[10px] text-muted bg-surface-secondary px-1.5 py-0.5 rounded font-mono shrink-0">
        {badge}
      </span>
    )}
  </NavLink>
);
