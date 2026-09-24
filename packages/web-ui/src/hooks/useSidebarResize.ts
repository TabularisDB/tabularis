import { useRef, useEffect, useCallback } from "react";
import { useUiState } from "./useUiState";
import { UI_STATE_KEYS } from "../utils/uiStateStore";

const MIN_WIDTH = 150;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 256;
const COLLAPSE_THRESHOLD = 100;
/** Coalesces writes while the handle is being dragged. */
const PERSIST_DEBOUNCE_MS = 300;

export const useSidebarResize = (onCollapse?: () => void) => {
  const [storedWidth, setSidebarWidth] = useUiState(
    UI_STATE_KEYS.sidebarWidth,
    DEFAULT_WIDTH,
    { debounceMs: PERSIST_DEBOUNCE_MS },
  );
  const sidebarWidth =
    typeof storedWidth === "number" && Number.isFinite(storedWidth)
      ? storedWidth
      : DEFAULT_WIDTH;
  const isDragging = useRef(false);
  const onCollapseRef = useRef(onCollapse);

  useEffect(() => {
    onCollapseRef.current = onCollapse;
  }, [onCollapse]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";

    const handleResize = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = e.clientX - 64; // Subtract primary sidebar width (w-16 = 64px)

      // Auto-collapse when dragged below threshold
      if (newWidth < COLLAPSE_THRESHOLD && onCollapseRef.current) {
        isDragging.current = false;
        document.body.style.cursor = "default";
        document.removeEventListener("mousemove", handleResize);
        document.removeEventListener("mouseup", stopResize);
        onCollapseRef.current();
        return;
      }

      if (newWidth > MIN_WIDTH && newWidth < MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const stopResize = () => {
      isDragging.current = false;
      document.body.style.cursor = "default";
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", stopResize);
    };

    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", stopResize);
  }, [setSidebarWidth]);

  return { sidebarWidth, startResize };
};
