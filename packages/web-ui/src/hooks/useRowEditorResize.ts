import { useCallback, useEffect, useRef, useState } from "react";

const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 384;
const STORAGE_KEY = "tabularis_row_editor_sidebar_width";

const computeMaxWidth = () =>
  typeof window === "undefined"
    ? 1200
    : Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.9));

export const useRowEditorResize = () => {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_WIDTH;
    const parsed = parseInt(saved, 10);
    if (Number.isNaN(parsed)) return DEFAULT_WIDTH;
    return Math.max(MIN_WIDTH, parsed);
  });
  const isDragging = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const maxWidth = computeMaxWidth();
      const next = window.innerWidth - ev.clientX;
      if (next < MIN_WIDTH) {
        setWidth(MIN_WIDTH);
      } else if (next > maxWidth) {
        setWidth(maxWidth);
      } else {
        setWidth(next);
      }
    };

    const stop = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", stop);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", stop);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  return { width, startResize };
};
