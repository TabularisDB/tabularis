import React, {useEffect, useLayoutEffect, useRef, useState, useMemo} from 'react';
import {ChevronRight} from 'lucide-react';
import {
    calculateContextMenuPosition,
    calculateSubmenuOffsetY,
    type ViewportConstraints,
} from '@/utils/contextMenu';

export interface ContextMenuItem {
    label?: string;
    icon?: React.ElementType;
    action?: () => void;
    danger?: boolean;
    disabled?: boolean;
    separator?: boolean;
    /** Renders a non-interactive section label instead of a clickable item. */
    header?: boolean;
    /** Header only: keep the label's case and use the mono font (identifiers). */
    mono?: boolean;
    /** Header only: secondary text shown after the label, truncated (full text on hover). */
    hint?: string;
    /** Short monospace tag (e.g. a SQL operator) shown in a chip before the label. */
    badge?: string;
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
const MenuRow = ({
    item,
    onClose,
    onKeyDown,
}: {
    item: ContextMenuItem;
    onClose: () => void;
    onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
}) => {
    if (item.separator) {
        return <div className="h-px bg-default my-1" />;
    }

    if (item.header) {
        return (
            <div
                className={`px-3 pt-1.5 pb-1 text-muted flex items-center gap-1.5 select-none ${
                    item.mono
                        ? 'text-xs font-mono'
                        : 'text-[10px] font-semibold uppercase tracking-wider'
                }`}
            >
                {item.icon && <item.icon size={11} className="shrink-0 text-muted" />}
                <span
                    className={
                        item.hint !== undefined ? 'shrink-0 max-w-[50%] truncate' : 'truncate'
                    }
                >
                    {item.label}
                </span>
                {item.hint !== undefined && (
                    <>
                        <span aria-hidden="true">·</span>
                        <span
                            title={item.hint}
                            className="min-w-0 max-w-[16rem] truncate text-primary"
                        >
                            {item.hint}
                        </span>
                    </>
                )}
            </div>
        );
    }

    const Icon = item.icon;
    const depth = item.indent ?? 0;
    return (
        <button
            onKeyDown={onKeyDown}
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
        ${
            item.disabled
                ? 'text-muted/50 cursor-not-allowed'
                : `hover:bg-surface-tertiary ${item.danger ? 'text-accent-error' : 'text-primary'}`
        }
      `}
        >
            {/* Tree guides — one rail per nesting level */}
            {depth > 0 && (
                <span className="self-stretch shrink-0 flex pl-3">
                    {Array.from({length: depth}).map((_, level) => (
                        <span
                            key={level}
                            className="relative self-stretch shrink-0"
                            style={{width: '0.85rem'}}
                        >
                            <span className="absolute inset-y-0 left-1/2 w-px bg-default/70" />
                            {level === depth - 1 && (
                                <span className="absolute left-1/2 top-1/2 h-px w-1/2 bg-default/70" />
                            )}
                        </span>
                    ))}
                </span>
            )}
            {item.badge !== undefined ? (
                <span className="shrink-0 min-w-[3.25rem] px-1 py-px rounded border border-default bg-surface-tertiary text-center font-mono text-[11px] font-semibold leading-4 text-accent [font-variant-ligatures:none]">
                    {item.badge}
                </span>
            ) : (
                Icon && (
                    <Icon
                        size={14}
                        className={`shrink-0 ${item.disabled ? 'text-muted/50' : item.danger ? 'text-accent-error' : 'text-secondary'}`}
                    />
                )
            )}
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
    // Vertical shift keeping the flyout inside the viewport when the row is
    // near the bottom edge (measured right after the flyout mounts).
    const [offsetY, setOffsetY] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const submenuRef = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const focusFirstOnOpen = useRef(false);
    const suppressFocusOpen = useRef(false);

    const cancelClose = () => {
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    };
    const scheduleClose = () => {
        cancelClose();
        closeTimer.current = setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
                setOpen(false);
                setOffsetY(0);
            }
        }, 120);
    };
    const closeSubmenu = () => {
        cancelClose();
        setOpen(false);
        setOffsetY(0);
    };
    const focusFirstItem = () => {
        submenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    };
    const handleSubmenuKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            suppressFocusOpen.current = true;
            closeSubmenu();
            triggerRef.current?.focus();
        }
    };

    useEffect(() => () => cancelClose(), []);

    useLayoutEffect(() => {
        if (!open) return;
        const el = submenuRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setOffsetY(calculateSubmenuOffsetY(rect.top, rect.height, window.innerHeight));
        if (focusFirstOnOpen.current) {
            focusFirstOnOpen.current = false;
            focusFirstItem();
        }
    }, [open]);

    const Icon = item.icon;
    return (
        <div
            ref={rootRef}
            className="relative"
            onMouseEnter={() => {
                cancelClose();
                setOpen(true);
            }}
            onMouseLeave={scheduleClose}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) closeSubmenu();
            }}
        >
            {/* A click also opens the flyout (focus and the arrow keys do too),
          so its items are reachable without a pointer hover. */}
            <button
                ref={triggerRef}
                type="button"
                disabled={item.disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => {
                    cancelClose();
                    setOpen(true);
                }}
                onFocus={() => {
                    if (suppressFocusOpen.current) {
                        suppressFocusOpen.current = false;
                        return;
                    }
                    cancelClose();
                    setOpen(true);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        if (open) focusFirstItem();
                        else {
                            focusFirstOnOpen.current = true;
                            setOpen(true);
                        }
                    } else if ((event.key === 'ArrowLeft' || event.key === 'Escape') && open) {
                        event.preventDefault();
                        event.stopPropagation();
                        closeSubmenu();
                    }
                }}
                className={`
          w-full text-left pl-3 pr-2 py-2 text-sm flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus
          ${
              item.disabled
                  ? 'text-muted/50 cursor-not-allowed'
                  : `text-primary ${open ? 'bg-surface-tertiary' : 'hover:bg-surface-tertiary'}`
          }
        `}
            >
                {Icon && (
                    <Icon
                        size={14}
                        className={`shrink-0 ${item.disabled ? 'text-muted/50' : 'text-secondary'}`}
                    />
                )}
                <span className="truncate flex-1">{item.label}</span>
                <ChevronRight size={14} className="shrink-0 text-muted" />
            </button>

            {open && !item.disabled && item.submenu && item.submenu.length > 0 && (
                <div
                    ref={submenuRef}
                    style={{top: offsetY}}
                    className={`
            absolute z-50 min-w-[180px] max-h-[60vh] overflow-y-auto
            bg-surface-secondary border border-strong rounded-lg shadow-xl py-1
            animate-in fade-in zoom-in-95 duration-100
            ${openLeft ? 'right-full mr-1 origin-top-right' : 'left-full ml-1 origin-top-left'}
          `}
                >
                    {item.submenu.map((sub, i) => {
                        const subKey = sub.separator
                            ? `sub-sep-${i}`
                            : sub.label
                              ? `${sub.label}-${i}`
                              : `sub-${i}`;
                        return (
                            <MenuRow
                                key={subKey}
                                item={sub}
                                onClose={onClose}
                                onKeyDown={handleSubmenuKeyDown}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const ContextMenu = ({x, y, items, onClose, children, boundaryRight}: ContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuSize, setMenuSize] = useState<{width: number; height: number} | null>(null);

    useEffect(() => {
        if (menuRef.current) {
            const menuRect = menuRef.current.getBoundingClientRect();
            setMenuSize({width: menuRect.width, height: menuRect.height});
        }
    }, []);

    const position = useMemo(() => {
        if (!menuSize) {
            return {top: y, left: x};
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
            {items.map((item, index) => {
                const key = item.separator
                    ? `sep-${index}`
                    : item.label
                      ? `${item.label}-${index}`
                      : `item-${index}`;
                return item.submenu ? (
                    <SubmenuRow
                        key={key}
                        item={item}
                        onClose={onClose}
                        openLeft={openSubmenuLeft}
                    />
                ) : (
                    <MenuRow key={key} item={item} onClose={onClose} />
                );
            })}
            {children}
        </div>
    );
};
