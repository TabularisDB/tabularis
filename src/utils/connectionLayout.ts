import type { ConnectionData } from '../contexts/DatabaseContext';

export type SplitMode = 'vertical' | 'horizontal';

/**
 * Tiling tree for the split view, Hyprland-style: a leaf is a connection
 * panel, a split arranges its children side by side ('vertical' mode) or
 * stacked ('horizontal' mode). sizes are percentage shares of the split.
 */
export type SplitNode =
  | { type: 'leaf'; connectionId: string }
  | { type: 'split'; mode: SplitMode; children: SplitNode[]; sizes: number[] };

export interface SplitView {
  /** The tiling tree; source of truth for the layout */
  layout: SplitNode;
  /** Leaf connection ids in visual order (derived from layout) */
  connectionIds: string[];
  /** Root split direction (derived; shown on the rail badge) */
  mode: SplitMode;
}

/** Edge of a split pane a dragged panel can be dropped on */
export type SplitEdge = 'left' | 'right' | 'top' | 'bottom';

/** Maximum number of connections a split group can hold */
export const MAX_SPLIT_CONNECTIONS = 4;

/** Minimum share (in %) a split pane can be resized down to */
export const MIN_SPLIT_PANE_SIZE = 10;

export function leaf(connectionId: string): SplitNode {
  return { type: 'leaf', connectionId };
}

/** Returns the leaf connection ids of the tree, in visual order */
export function flattenLayout(node: SplitNode): string[] {
  if (node.type === 'leaf') return [node.connectionId];
  return node.children.flatMap(flattenLayout);
}

/** Builds a flat one-level tree from a list of connection ids */
export function layoutFromIds(ids: string[], mode: SplitMode): SplitNode | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) return leaf(ids[0]);
  return { type: 'split', mode, children: ids.map(leaf), sizes: defaultSplitSizes(ids.length) };
}

/** Wraps a layout tree into a SplitView with its derived fields */
export function makeSplitView(layout: SplitNode | null): SplitView | null {
  if (!layout) return null;
  const connectionIds = flattenLayout(layout);
  if (connectionIds.length === 0) return null;
  return {
    layout,
    connectionIds,
    mode: layout.type === 'split' ? layout.mode : 'vertical',
  };
}

/** Returns true if the connection belongs to the active split view */
export function isConnectionGrouped(connectionId: string, splitView: SplitView | null): boolean {
  if (!splitView) return false;
  return splitView.connectionIds.includes(connectionId);
}

/** Returns the connection data for a specific connectionId from the map */
export function buildPanelDatabaseData(
  connectionId: string,
  connectionDataMap: Record<string, ConnectionData>,
): ConnectionData | undefined {
  return connectionDataMap[connectionId];
}

/** Returns true if between 2 and MAX_SPLIT_CONNECTIONS connections are selected */
export function canActivateSplit(selectedIds: Set<string>): boolean {
  return selectedIds.size >= 2 && selectedIds.size <= MAX_SPLIT_CONNECTIONS;
}

/** Returns true if the connection can be added to the current split group */
export function canAddToSplit(splitView: SplitView | null, connectionId: string): boolean {
  if (!splitView) return false;
  return (
    splitView.connectionIds.length < MAX_SPLIT_CONNECTIONS &&
    !splitView.connectionIds.includes(connectionId)
  );
}

/** Returns equal percentage shares for the given number of panes */
export function defaultSplitSizes(paneCount: number): number[] {
  return Array.from({ length: paneCount }, () => 100 / paneCount);
}

/**
 * Returns new pane shares after dragging the divider between pane
 * `dividerIndex` and the next one by `deltaPercent`. Only the two panes
 * adjacent to the divider change; both are clamped to MIN_SPLIT_PANE_SIZE.
 */
export function resizeSplitSizes(
  sizes: number[],
  dividerIndex: number,
  deltaPercent: number,
): number[] {
  if (dividerIndex < 0 || dividerIndex >= sizes.length - 1) return sizes;
  const left = sizes[dividerIndex];
  const right = sizes[dividerIndex + 1];
  const clampedDelta = Math.max(
    MIN_SPLIT_PANE_SIZE - left,
    Math.min(deltaPercent, right - MIN_SPLIT_PANE_SIZE),
  );
  if (clampedDelta === 0) return sizes;
  const next = [...sizes];
  next[dividerIndex] = left + clampedDelta;
  next[dividerIndex + 1] = right - clampedDelta;
  return next;
}

/**
 * Removes a leaf from the tree. Splits left with a single child collapse
 * into that child; remaining shares are rescaled to sum to 100.
 */
export function removeFromLayout(node: SplitNode, connectionId: string): SplitNode | null {
  if (node.type === 'leaf') {
    return node.connectionId === connectionId ? null : node;
  }
  const children: SplitNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const next = removeFromLayout(child, connectionId);
    if (next) {
      children.push(next);
      sizes.push(node.sizes[i] ?? 100 / node.children.length);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...node, children, sizes: sizes.map(s => (s / total) * 100) };
}

/**
 * Inserts a new leaf on the given edge of the target leaf. If the target's
 * parent split already flows in the drop direction the new leaf joins it as
 * a sibling (taking half of the target's share); otherwise the target leaf
 * is replaced by a nested split of the two.
 */
export function insertIntoLayout(
  node: SplitNode,
  targetId: string,
  connectionId: string,
  edge: SplitEdge,
): SplitNode {
  const mode: SplitMode = edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal';
  const before = edge === 'left' || edge === 'top';

  const insert = (n: SplitNode): SplitNode => {
    if (n.type === 'leaf') {
      if (n.connectionId !== targetId) return n;
      return {
        type: 'split',
        mode,
        children: before ? [leaf(connectionId), n] : [n, leaf(connectionId)],
        sizes: [50, 50],
      };
    }
    if (n.mode === mode) {
      const idx = n.children.findIndex(c => c.type === 'leaf' && c.connectionId === targetId);
      if (idx !== -1) {
        const children = [...n.children];
        const sizes = [...n.sizes];
        const share = (sizes[idx] ?? 100 / children.length) / 2;
        sizes[idx] = share;
        const at = before ? idx : idx + 1;
        children.splice(at, 0, leaf(connectionId));
        sizes.splice(at, 0, share);
        return { ...n, children, sizes };
      }
    }
    return { ...n, children: n.children.map(insert) };
  };

  return insert(node);
}

/**
 * Moves a panel onto the given edge of another panel, Hyprland-style:
 * the dragged leaf is removed from its position and re-tiled next to the
 * target, nesting or joining a split as needed.
 */
export function moveInSplit(
  splitView: SplitView,
  draggedId: string,
  targetId: string,
  edge: SplitEdge,
): SplitView {
  if (draggedId === targetId) return splitView;
  if (!splitView.connectionIds.includes(draggedId) || !splitView.connectionIds.includes(targetId)) {
    return splitView;
  }
  const without = removeFromLayout(splitView.layout, draggedId);
  if (!without) return splitView;
  return makeSplitView(insertIntoLayout(without, targetId, draggedId, edge)) ?? splitView;
}

/** Returns a new split view with the connection appended to the root split */
export function addToSplit(splitView: SplitView, connectionId: string): SplitView {
  if (!canAddToSplit(splitView, connectionId)) return splitView;
  const layout = splitView.layout;
  let next: SplitNode;
  if (layout.type === 'split') {
    const count = layout.children.length;
    const scale = count / (count + 1);
    next = {
      ...layout,
      children: [...layout.children, leaf(connectionId)],
      sizes: [...layout.sizes.map(s => s * scale), 100 / (count + 1)],
    };
  } else {
    next = {
      type: 'split',
      mode: 'vertical',
      children: [layout, leaf(connectionId)],
      sizes: [50, 50],
    };
  }
  return makeSplitView(next) ?? splitView;
}

/** Returns a new split view with the two panels swapped in place */
export function swapInSplit(splitView: SplitView, aId: string, bId: string): SplitView {
  if (aId === bId) return splitView;
  if (!splitView.connectionIds.includes(aId) || !splitView.connectionIds.includes(bId)) {
    return splitView;
  }
  const swap = (n: SplitNode): SplitNode => {
    if (n.type === 'leaf') {
      if (n.connectionId === aId) return leaf(bId);
      if (n.connectionId === bId) return leaf(aId);
      return n;
    }
    return { ...n, children: n.children.map(swap) };
  };
  return makeSplitView(swap(splitView.layout)) ?? splitView;
}

/** Returns the split node at the given path of child indices, if any */
export function getSplitNodeAt(node: SplitNode, path: number[]): SplitNode | null {
  let current: SplitNode = node;
  for (const idx of path) {
    if (current.type !== 'split' || !current.children[idx]) return null;
    current = current.children[idx];
  }
  return current;
}

/** Returns a new tree with the sizes of the split node at `path` replaced */
export function resizeLayoutAt(node: SplitNode, path: number[], sizes: number[]): SplitNode {
  if (node.type === 'leaf') return node;
  if (path.length === 0) return { ...node, sizes };
  const [head, ...rest] = path;
  return {
    ...node,
    children: node.children.map((c, i) => (i === head ? resizeLayoutAt(c, rest, sizes) : c)),
  };
}

/** A rectangle in percent of the split container */
export interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PaneGeometry {
  connectionId: string;
  rect: PaneRect;
}

export interface DividerGeometry {
  /** Path of the split node this divider belongs to */
  path: number[];
  /** Divider sits between children `index` and `index + 1` */
  index: number;
  /** Direction of the split ('vertical' → the divider is a vertical bar) */
  mode: SplitMode;
  /** Boundary position along the split's main axis, in % of container */
  pos: number;
  /** Start and extent on the cross axis, in % of container */
  crossStart: number;
  crossSize: number;
  /** The split node's main-axis extent, in % of container (for drag math) */
  nodeMainSize: number;
}

/**
 * Computes absolute rectangles (in % of the container) for every pane and
 * divider of the tree. Panels can then be positioned without nesting DOM
 * containers, which keeps their nodes stable across layout changes.
 */
export function computeLayoutGeometry(
  node: SplitNode,
  rect: PaneRect = { left: 0, top: 0, width: 100, height: 100 },
  path: number[] = [],
): { panes: PaneGeometry[]; dividers: DividerGeometry[] } {
  if (node.type === 'leaf') {
    return { panes: [{ connectionId: node.connectionId, rect }], dividers: [] };
  }
  const panes: PaneGeometry[] = [];
  const dividers: DividerGeometry[] = [];
  const isVertical = node.mode === 'vertical';
  const mainSize = isVertical ? rect.width : rect.height;
  let offset = isVertical ? rect.left : rect.top;

  node.children.forEach((child, i) => {
    const share = node.sizes[i] ?? 100 / node.children.length;
    const childSize = (mainSize * share) / 100;
    const childRect: PaneRect = isVertical
      ? { left: offset, top: rect.top, width: childSize, height: rect.height }
      : { left: rect.left, top: offset, width: rect.width, height: childSize };
    const sub = computeLayoutGeometry(child, childRect, [...path, i]);
    panes.push(...sub.panes);
    dividers.push(...sub.dividers);
    offset += childSize;
    if (i < node.children.length - 1) {
      dividers.push({
        path,
        index: i,
        mode: node.mode,
        pos: offset,
        crossStart: isVertical ? rect.top : rect.left,
        crossSize: isVertical ? rect.height : rect.width,
        nodeMainSize: mainSize,
      });
    }
  });
  return { panes, dividers };
}

/** Returns the pane edge closest to the pointer position */
export function getPanelDropEdge(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): SplitEdge {
  const x = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const y = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  const distances: Array<[SplitEdge, number]> = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  return distances.reduce((closest, candidate) =>
    candidate[1] < closest[1] ? candidate : closest,
  )[0];
}
