import { useCallback, useRef } from "react";

interface ResizeHandleProps {
  onResize: (height: number) => void;
  minHeight?: number;
  maxHeight?: number;
}

export function ResizeHandle({
  onResize,
  minHeight = 100,
  maxHeight = 800,
}: ResizeHandleProps) {
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startYRef.current = e.clientY;
      const parentEl = containerRef.current?.parentElement;
      startHeightRef.current = parentEl?.offsetHeight ?? 300;

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startYRef.current;
        const newHeight = Math.min(
          maxHeight,
          Math.max(minHeight, startHeightRef.current + delta),
        );
        onResize(newHeight);
      };

      // Overlay prevents editors from capturing mouse events during drag
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:9999;cursor:row-resize";
      document.body.appendChild(overlay);

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        overlay.remove();
      };

      document.body.style.cursor = "row-resize";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onResize, minHeight, maxHeight],
  );

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      className="h-1.5 cursor-row-resize bg-transparent hover:bg-blue-500/20 transition-colors flex items-center justify-center group"
    >
      <div className="w-8 h-0.5 rounded-full bg-default group-hover:bg-blue-500/50 transition-colors" />
    </div>
  );
}
