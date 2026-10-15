import { useEffect, useRef, useState } from "react";

export const useContainerWidth = <T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  width: number;
} => {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(el.clientWidth);
      return;
    }
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(Math.round(entry.contentRect.width));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
};

// 480px ≈ ~240px per Monaco pane — minimum where each side still
// fits a meaningful chunk of text.
export const MIN_SIDE_BY_SIDE_WIDTH = 480;
