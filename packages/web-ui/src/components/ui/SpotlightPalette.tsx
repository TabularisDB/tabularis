import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Loader2, Search, X } from "lucide-react";
import { Modal } from "./Modal";

interface SpotlightPaletteProps {
  ariaLabel: string;
  searchLabel: string;
  closeLabel: string;
  placeholder: string;
  query: string;
  itemCount: number;
  selectedIndex: number;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (index: number) => void;
  onSubmit: (index: number) => void;
  children: ReactNode;
  footer: ReactNode;
  isBusy?: boolean;
  resultsId: string;
  activeDescendant?: string;
}

export const SpotlightPalette = ({
  ariaLabel,
  searchLabel,
  closeLabel,
  placeholder,
  query,
  itemCount,
  selectedIndex,
  onClose,
  onQueryChange,
  onSelectedIndexChange,
  onSubmit,
  children,
  footer,
  isBusy = false,
  resultsId,
  activeDescendant,
}: SpotlightPaletteProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Moving the selection would unmount the action the user is standing on and
    // drop focus to the body, so arrows are inert inside the action group.
    if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      event.target instanceof Element &&
      event.target.closest("[data-palette-actions]")
    ) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelectedIndexChange(
        itemCount === 0 ? 0 : (selectedIndex + 1) % itemCount,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelectedIndexChange(
        itemCount === 0
          ? 0
          : (selectedIndex - 1 + itemCount) % itemCount,
      );
      return;
    }

    if (event.key === "Tab") {
      const focusableElements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (
        event.shiftKey &&
        firstElement &&
        document.activeElement === firstElement
      ) {
        event.preventDefault();
        lastElement?.focus();
      } else if (
        !event.shiftKey &&
        lastElement &&
        document.activeElement === lastElement
      ) {
        event.preventDefault();
        firstElement?.focus();
      }
      return;
    }

    if (event.key === "Enter") {
      if (event.target instanceof HTMLButtonElement) {
        return;
      }
      event.preventDefault();
      if (itemCount > 0) onSubmit(selectedIndex);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop
      overlayClassName="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-busy={isBusy}
        onKeyDown={handleKeyDown}
        className="flex max-h-[60vh] w-[min(640px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-strong bg-elevated shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-default bg-base px-4 py-3">
          {isBusy ? (
            <Loader2
              size={18}
              className="shrink-0 animate-spin text-blue-400"
            />
          ) : (
            <Search size={18} className="shrink-0 text-secondary" />
          )}
          <span
            aria-hidden="true"
            className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary"
          >
            {ariaLabel}
          </span>
          <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
            role="combobox"
            aria-label={searchLabel}
            aria-controls={resultsId}
            aria-expanded="true"
            aria-activedescendant={activeDescendant}
            autoFocus
            type="text"
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              onSelectedIndexChange(0);
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded p-1 text-secondary transition-colors hover:bg-surface-secondary hover:text-primary"
          >
            <X size={18} />
          </button>
        </div>

        {children}

        <div className="flex justify-between border-t border-default bg-base/50 px-4 py-2 text-[11px] text-muted">
          {footer}
        </div>
      </div>
    </Modal>
  );
};
