import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { calculateContextMenuPosition } from "../../utils/contextMenu";

export interface ThemeMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

/** Small anchored menu shared by theme cards and the import/maintenance toolbar. */
export function ThemeActionsMenu({ label, items, children, disabled = false }: {
  label: string;
  items: ThemeMenuItem[];
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback((restoreFocus = false) => {
    setPosition(undefined);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  const open = () => {
    if (!trigger.current || disabled) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(256, window.innerWidth - 16);
    setPosition(calculateContextMenuPosition({
      clickX: rect.right - width, clickY: rect.bottom + 6,
      menuWidth: width, menuHeight: items.length * 36 + 8 + items.filter((item) => item.separatorBefore).length * 5,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, margin: 8,
    }));
  };

  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
    };
    const reposition = () => close();
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [position, close]);

  return <>
    <button
      ref={trigger} type="button" disabled={disabled} aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={!!position} aria-controls={position ? id : undefined}
      onClick={() => position ? close() : open()}
      onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); open(); } }}
      className={clsx("inline-flex items-center justify-center gap-1.5 rounded-lg text-muted transition-colors hover:bg-surface-secondary hover:text-primary focus-visible:outline focus-visible:outline-focus disabled:opacity-40 disabled:cursor-not-allowed", children ? "border border-default px-3 py-2 text-xs" : "p-1.5")}
    >{children ?? <MoreHorizontal size={16} />}</button>
    {position && createPortal(<div
      ref={menu} id={id} role="menu" tabIndex={-1} aria-label={label} style={position}
      className="fixed z-[200] w-64 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-strong bg-elevated p-1 shadow-xl"
      onKeyDown={(event) => {
        if (event.key === "Tab") { close(true); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        if (!buttons.length) return;
        const index = buttons.findIndex((button) => button === document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >{items.map(({ icon: Icon, ...item }) => <div key={item.label} role="none" className={item.separatorBefore ? "mt-1 border-t border-default pt-1" : undefined}>
      <button type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} title={item.label}
        onPointerMove={(event) => { if (!item.disabled && event.pointerType !== "touch") event.currentTarget.focus({ preventScroll: true }); }}
        onClick={() => { close(true); item.onSelect(); }}
        className={clsx("flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors focus:bg-surface-secondary focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed", item.danger ? "text-accent-error" : "text-primary")}
      ><Icon size={14} className="shrink-0" /><span className="truncate">{item.label}</span></button>
    </div>)}</div>, document.body)}
  </>;
}
