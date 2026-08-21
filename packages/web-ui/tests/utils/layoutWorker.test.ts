import { describe, it, expect } from 'vitest';
import {
  Position,
  NODE_WIDTH,
  NODE_BASE_HEIGHT,
  NODE_ROW_HEIGHT,
  calculateNodeHeight,
  getNodePositions,
  calculateCenteredPosition,
  type PositionType,
} from '../../src/utils/layoutWorker';

describe('layoutWorker', () => {
  describe('Position constants', () => {
    it('should have correct position values', () => {
      expect(Position.Left).toBe('left');
      expect(Position.Right).toBe('right');
      expect(Position.Top).toBe('top');
      expect(Position.Bottom).toBe('bottom');
    });

    it('should be read-only', () => {
      // TypeScript enforces this, but we can test the object is defined
      expect(Position).toBeDefined();
      expect(Object.keys(Position).length).toBe(4);
    });
  });

  describe('Node size constants', () => {
    it('should export correct node dimensions', () => {
      expect(NODE_WIDTH).toBe(240);
      expect(NODE_BASE_HEIGHT).toBe(40);
      expect(NODE_ROW_HEIGHT).toBe(28);
    });

    it('should have positive values', () => {
      expect(NODE_WIDTH).toBeGreaterThan(0);
      expect(NODE_BASE_HEIGHT).toBeGreaterThan(0);
      expect(NODE_ROW_HEIGHT).toBeGreaterThan(0);
    });
  });

  describe('calculateNodeHeight', () => {
    it('should calculate height for zero columns', () => {
      expect(calculateNodeHeight(0)).toBe(40);
    });

    it('should calculate height for one column', () => {
      expect(calculateNodeHeight(1)).toBe(68); // 40 + 28
    });

    it('should calculate height for multiple columns', () => {
      expect(calculateNodeHeight(5)).toBe(180); // 40 + (5 * 28)
      expect(calculateNodeHeight(10)).toBe(320); // 40 + (10 * 28)
      expect(calculateNodeHeight(20)).toBe(600); // 40 + (20 * 28)
    });

    it('should handle negative columns as base height', () => {
      expect(calculateNodeHeight(-1)).toBe(40);
      expect(calculateNodeHeight(-10)).toBe(40);
    });

    it('should return correct formula: BASE + (columns * ROW_HEIGHT)', () => {
      const columns = 7;
      const expected = NODE_BASE_HEIGHT + (columns * NODE_ROW_HEIGHT);
      expect(calculateNodeHeight(columns)).toBe(expected);
    });

    it('should handle large number of columns', () => {
      expect(calculateNodeHeight(100)).toBe(2840); // 40 + (100 * 28)
      expect(calculateNodeHeight(1000)).toBe(28040); // 40 + (1000 * 28)
    });
  });

  describe('getNodePositions', () => {
    it('should return horizontal positions for LR direction', () => {
      const result = getNodePositions('LR');

      expect(result.sourcePosition).toBe('right');
      expect(result.targetPosition).toBe('left');
    });

    it('should return vertical positions for TB direction', () => {
      const result = getNodePositions('TB');

      expect(result.sourcePosition).toBe('bottom');
      expect(result.targetPosition).toBe('top');
    });

    it('should return vertical positions for unknown directions', () => {
      const result = getNodePositions('UNKNOWN');

      expect(result.sourcePosition).toBe('bottom');
      expect(result.targetPosition).toBe('top');
    });

    it('should treat empty string as vertical (TB)', () => {
      const result = getNodePositions('');

      expect(result.sourcePosition).toBe('bottom');
      expect(result.targetPosition).toBe('top');
    });

    it('should be case-sensitive', () => {
      // 'lr' is not 'LR', so it should default to TB
      const result = getNodePositions('lr');

      expect(result.sourcePosition).toBe('bottom');
      expect(result.targetPosition).toBe('top');
    });

    it('should return correct position types', () => {
      const resultLR = getNodePositions('LR');
      const resultTB = getNodePositions('TB');

      // Verify these are valid PositionType values
      const validPositions: PositionType[] = ['left', 'right', 'top', 'bottom'];
      expect(validPositions).toContain(resultLR.sourcePosition);
      expect(validPositions).toContain(resultLR.targetPosition);
      expect(validPositions).toContain(resultTB.sourcePosition);
      expect(validPositions).toContain(resultTB.targetPosition);
    });
  });

  describe('calculateCenteredPosition', () => {
    it('should center a node at origin', () => {
      const result = calculateCenteredPosition(0, 0, 240, 100);

      expect(result.x).toBe(-120); // 0 - 240/2
      expect(result.y).toBe(-50);  // 0 - 100/2
    });

    it('should center a node at positive coordinates', () => {
      const result = calculateCenteredPosition(100, 200, 240, 100);

      expect(result.x).toBe(-20);  // 100 - 240/2
      expect(result.y).toBe(150);  // 200 - 100/2
    });

    it('should center a node with exact center point', () => {
      const result = calculateCenteredPosition(120, 50, 240, 100);

      expect(result.x).toBe(0);   // 120 - 120
      expect(result.y).toBe(0);   // 50 - 50
    });

    it('should handle negative center coordinates', () => {
      const result = calculateCenteredPosition(-100, -200, 240, 100);

      expect(result.x).toBe(-220); // -100 - 120
      expect(result.y).toBe(-250); // -200 - 50
    });

    it('should handle odd dimensions', () => {
      const result = calculateCenteredPosition(100, 100, 241, 101);

      expect(result.x).toBe(-20.5);  // 100 - 241/2
      expect(result.y).toBe(49.5);   // 100 - 101/2
    });

    it('should handle zero width and height', () => {
      const result = calculateCenteredPosition(100, 200, 0, 0);

      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
    });

    it('should work with real-world node dimensions', () => {
      // Typical node: 240x180 centered at (500, 400)
      const result = calculateCenteredPosition(500, 400, NODE_WIDTH, 180);

      expect(result.x).toBe(380);  // 500 - 120
      expect(result.y).toBe(310);  // 400 - 90
    });

    it('should calculate position for varying node heights', () => {
      const centerX = 300;
      const centerY = 300;

      // Small node (0 columns)
      const small = calculateCenteredPosition(
        centerX,
        centerY,
        NODE_WIDTH,
        calculateNodeHeight(0)
      );
      expect(small.x).toBe(180); // 300 - 120
      expect(small.y).toBe(280); // 300 - 20

      // Large node (20 columns)
      const large = calculateCenteredPosition(
        centerX,
        centerY,
        NODE_WIDTH,
        calculateNodeHeight(20)
      );
      expect(large.x).toBe(180);  // 300 - 120
      expect(large.y).toBe(0);    // 300 - 300
    });
  });
});
