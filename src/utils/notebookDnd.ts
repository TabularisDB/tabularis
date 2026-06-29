import type { NotebookCell, NotebookCellType } from "../types/notebook";

export function reorderCells(
  cells: NotebookCell[],
  fromIndex: number,
  toIndex: number,
): NotebookCell[] {
  if (fromIndex === toIndex) return cells;
  if (fromIndex < 0 || fromIndex >= cells.length) return cells;
  if (toIndex < 0 || toIndex >= cells.length) return cells;

  const result = [...cells];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

/**
 * Build a "held card" element to use as the native drag image while a cell is
 * being reordered, so a small ghost of the cell follows the cursor instead of
 * the browser's default faded screenshot. The element is appended off-screen
 * (the browser snapshots it synchronously); callers are responsible for
 * removing it once the drag has started.
 */
export function createCellDragPreview(
  doc: Document,
  { name, typeLabel, type }: { name: string; typeLabel: string; type: NotebookCellType },
): HTMLElement {
  const el = doc.createElement("div");
  el.className =
    "flex max-w-[260px] items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-2 text-sm text-primary shadow-lg";
  // Keep it rendered (so it can be snapshotted) but out of view.
  el.style.position = "fixed";
  el.style.top = "-1000px";
  el.style.left = "-1000px";
  el.style.pointerEvents = "none";

  const badge = doc.createElement("span");
  badge.className =
    type === "sql"
      ? "shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-xs font-medium text-blue-500"
      : "shrink-0 rounded bg-purple-500/15 px-1.5 py-0.5 text-xs font-medium text-purple-500";
  badge.textContent = typeLabel;

  const label = doc.createElement("span");
  label.className = "truncate";
  label.textContent = name;

  el.appendChild(badge);
  el.appendChild(label);
  doc.body.appendChild(el);
  return el;
}

/**
 * Compute the auto-scroll speed (px/frame) for a scrollable container while a
 * cell is being dragged near its edges. Returns a negative value to scroll up,
 * positive to scroll down, and 0 when the cursor is comfortably inside.
 *
 * Native HTML5 drag does not auto-scroll the container, so without this a tall
 * cell makes it impossible to reach the edge and drag past it.
 */
export function computeAutoScrollSpeed(
  rect: { top: number; bottom: number },
  clientY: number,
  edgeSize = 60,
  maxSpeed = 16,
): number {
  const topDist = clientY - rect.top;
  const bottomDist = rect.bottom - clientY;
  if (topDist < edgeSize) {
    const intensity = Math.min(1, (edgeSize - topDist) / edgeSize);
    return -Math.ceil(intensity * maxSpeed);
  }
  if (bottomDist < edgeSize) {
    const intensity = Math.min(1, (edgeSize - bottomDist) / edgeSize);
    return Math.ceil(intensity * maxSpeed);
  }
  return 0;
}

/**
 * Move a cell to a gap-based insertion point. `insertAt` is the index of the
 * gap *before* which the cell should land, in the range [0, cells.length] —
 * so `0` means "before the first cell" and `cells.length` means "after the
 * last cell". Dropping into the gap directly above or below the dragged cell
 * is a no-op.
 */
export function moveCell(
  cells: NotebookCell[],
  fromIndex: number,
  insertAt: number,
): NotebookCell[] {
  if (fromIndex < 0 || fromIndex >= cells.length) return cells;
  if (insertAt < 0 || insertAt > cells.length) return cells;
  if (insertAt === fromIndex || insertAt === fromIndex + 1) return cells;

  const result = [...cells];
  const [moved] = result.splice(fromIndex, 1);
  // After removing the cell, indices past it shift left by one.
  const target = insertAt > fromIndex ? insertAt - 1 : insertAt;
  result.splice(target, 0, moved);
  return result;
}

export function getDropIndex(
  _containerRect: DOMRect,
  cellRects: DOMRect[],
  clientY: number,
  dragIndex: number,
): number {
  for (let i = 0; i < cellRects.length; i++) {
    const rect = cellRects[i];
    const midY = rect.top + rect.height / 2;
    if (clientY < midY) {
      return i <= dragIndex ? i : i;
    }
  }
  return cellRects.length - 1;
}
