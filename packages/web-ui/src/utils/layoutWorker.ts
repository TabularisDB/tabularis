/**
 * Layout utilities for graph/diagram positioning
 * Extracted from layoutWorker.ts for testability
 */

/**
 * Position enum values for graph nodes
 * Hardcoded to avoid importing from @xyflow/react in worker context
 */
export const Position = {
  Left: 'left',
  Right: 'right',
  Top: 'top',
  Bottom: 'bottom',
} as const;

export type PositionType = typeof Position[keyof typeof Position];

/**
 * Constants for node sizing
 */
export const NODE_WIDTH = 240;
export const NODE_BASE_HEIGHT = 40;
export const NODE_ROW_HEIGHT = 28;

/**
 * Calculate the height of a node based on the number of columns
 * @param columns - Number of columns in the table/node
 * @returns Calculated height in pixels
 */
export function calculateNodeHeight(columns: number): number {
  if (columns < 0) return NODE_BASE_HEIGHT;
  return NODE_BASE_HEIGHT + (columns * NODE_ROW_HEIGHT);
}

/**
 * Get source and target positions based on graph direction
 * @param direction - Graph direction ('LR' for left-to-right, 'TB' for top-to-bottom)
 * @returns Object with sourcePosition and targetPosition
 */
export function getNodePositions(direction: string): {
  sourcePosition: PositionType;
  targetPosition: PositionType;
} {
  const isHorizontal = direction === 'LR';

  return {
    sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
    targetPosition: isHorizontal ? Position.Left : Position.Top,
  };
}

/**
 * Calculate the centered position for a node
 * @param x - X coordinate from dagre (center point)
 * @param y - Y coordinate from dagre (center point)
 * @param width - Node width
 * @param height - Node height
 * @returns Position object with top-left coordinates
 */
export function calculateCenteredPosition(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  return {
    x: x - width / 2,
    y: y - height / 2,
  };
}
