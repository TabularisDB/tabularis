import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { calculateContextMenuPosition, type ViewportConstraints } from '../../utils/contextMenu';

export interface ContextMenuItem {
  label?: string;
  icon?: React.ElementType;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** Renders a non-interactive section label instead of a clickable item. */
  header?: boolean;
  /** Nesting depth for tree-style menus; adds left indentation per level. */
  indent?: number;
  /** When set, the item opens a flyout submenu to the side on hover. */
  submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Optional additional content rendered after the menu items (e.g. plugin slot anchors) */
  children?: React.ReactNode;
  /** Optional right boundary in px. Menu won't extend past this x coordinate. */
  boundaryRight?: number;
}

/** Renders a single interactive/label/separator row (no submenu handling). */
const MenuRow = ({ item, onClose }: { item: ContextMenuItem; onClose: () => void }) => {
  if (item.separator) {
    return <div className="h-px bg-default my-1" />;
  }

  if (item.header) {
    return (
      <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5 select-none">
        {item.icon && <item.icon size={11} className="text-muted" />}
        {item.label}
      </div>
    );
  }

  const Icon = item.icon;
  const depth = item.indent ?? 0;
  return (
    <button
      onClick={() => {
        if (!item.disabled && item.action) {
          item.action();
          onClose();
        }
      }}
      disabled={item.disabled}
      className={`
        w-full text-left pr-3 py-2 text-sm flex items-center gap-2
        ${depth === 0 ? 'pl-3' : 'pl-0'}
        ${item.disabled
          ? 'text-muted/50 cursor-not-allowed'
          : `hover:bg-surface-tertiary ${item.danger ? 'text-red-400' : 'text-primary'}`
        }
      `}
    >
      {/* Tree guides — one rail per nesting level */}
      {depth > 0 && (
        <span className="self-stretch shrink-0 flex pl-3">
          {Array.from({ length: depth }).map((_, level) => (
            <span
              key={level}
              className="relative self-stretch shrink-0"
              style={{ width: '0.85rem' }}
            >
              <span className="absolute inset-y-0 left-1/2 w-px bg-default/70" />
              {level === depth - 1 && (
                <span className="absolute left-1/2 top-1/2 h-px w-1/2 bg-default/70" />
              )}
            </span>
          ))}
        </span>
      )}
      {Icon && <Icon size={14} className={`shrink-0 ${item.disabled ? 'text-muted/50' : item.danger ? 'text-red-400' : 'text-secondary'}`} />}
      <span className="truncate">{item.label}</span>
    </button>
  );
};

/** An item that opens a flyout submenu on hover, flipping side to stay on-screen. */
const SubmenuRow = ({
  item,
  onClose,
  openLeft,
}: {
  item: ContextMenuItem;
  onClose: () => void;
  openLeft: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => cancelClose(), []);

  const Icon = item.icon;
  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        disabled={item.disabled}
        className={`
          w-full text-left pl-3 pr-2 py-2 text-sm flex items-center gap-2
          ${item.disabled
            ? 'text-muted/50 cursor-not-allowed'
            : `text-primary ${open ? 'bg-surface-tertiary' : 'hover:bg-surface-tertiary'}`
          }
        `}
      >
        {Icon && <Icon size={14} className={`shrink-0 ${item.disabled ? 'text-muted/50' : 'text-secondary'}`} />}
        <span className="truncate flex-1">{item.label}</span>
        <ChevronRight size={14} className="shrink-0 text-muted" />
      </button>

      {open && !item.disabled && item.submenu && item.submenu.length > 0 && (
        <div
          className={`
            absolute top-0 z-50 min-w-[180px] max-h-[60vh] overflow-y-auto
            bg-surface-secondary border border-strong rounded-lg shadow-xl py-1
            animate-in fade-in zoom-in-95 duration-100
            ${openLeft ? 'right-full mr-1 origin-top-right' : 'left-full ml-1 origin-top-left'}
          `}
        >
          {item.submenu.map((sub, i) => (
            <MenuRow key={i} item={sub} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  );
};

export const ContextMenu = ({ x, y, items, onClose, children, boundaryRight }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuSize, setMenuSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (menuRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect();
      setMenuSize({ width: menuRect.width, height: menuRect.height });
    }
  }, []);

  const position = useMemo(() => {
    if (!menuSize) {
      return { top: y, left: x };
    }

    const constraints: ViewportConstraints = {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      menuWidth: menuSize.width,
      menuHeight: menuSize.height,
      clickX: x,
      clickY: y,
      margin: 10,
      boundaryRight,
    };

    return calculateContextMenuPosition(constraints);
  }, [x, y, menuSize, boundaryRight]);

  // Flyout submenus open to the right by default, flipping left when there
  // isn't enough room (estimated 200px submenu width).
  const openSubmenuLeft = useMemo(() => {
    const width = menuSize?.width ?? 180;
    return position.left + width + 200 > window.innerWidth;
  }, [position.left, menuSize]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep within viewport
  const style: React.CSSProperties = {
    top: position.top,
    left: position.left,
  };

  return (
    <div
      ref={menuRef}
      style={style}
      className="fixed z-50 min-w-[160px] bg-surface-secondary border border-strong rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
    >
      {items.map((item, index) =>
        item.submenu ? (
          <SubmenuRow key={index} item={item} onClose={onClose} openLeft={openSubmenuLeft} />
        ) : (
          <MenuRow key={index} item={item} onClose={onClose} />
        ),
      )}
      {children}
    </div>
  );
};
