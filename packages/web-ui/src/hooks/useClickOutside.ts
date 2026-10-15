import { useEffect, useRef } from "react";

/**
 * Calls `onOutside` when a mousedown lands outside the referenced element.
 * Only listens while `enabled` is true, so dropdowns can bind it to their
 * open state instead of mounting a full-screen backdrop element (backdrops
 * break inside CSS containers, where `position: fixed` resolves against the
 * container instead of the viewport).
 */
export const useClickOutside = <T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onOutside: () => void,
  enabled: boolean,
) => {
  // Keep the latest callback without re-subscribing the listener on every
  // render (callers can pass inline closures).
  const handlerRef = useRef(onOutside);
  useEffect(() => {
    handlerRef.current = onOutside;
  });

  useEffect(() => {
    if (!enabled) return;
    const handleMouseDown = (e: MouseEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        handlerRef.current();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [ref, enabled]);
};
