import { describe, it, expect } from 'vitest';
import {
  calculateContextMenuPosition,
  calculateSubmenuOffsetY,
  shouldPositionLeft,
  shouldPositionAbove,
  clamp,
  type ViewportConstraints,
} from '../../src/utils/contextMenu';

describe('contextMenu utils', () => {
  describe('calculateContextMenuPosition', () => {
    it('should return click position when menu fits within viewport', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 1920,
        viewportHeight: 1080,
        menuWidth: 200,
        menuHeight: 300,
        clickX: 500,
        clickY: 400,
      };
      
      const result = calculateContextMenuPosition(constraints);
      expect(result.left).toBe(500);
      expect(result.top).toBe(400);
    });

    it('should adjust left position when menu overflows right edge', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 800,
        viewportHeight: 600,
        menuWidth: 300,
        menuHeight: 200,
        clickX: 700,
        clickY: 100,
        margin: 10,
      };
      
      const result = calculateContextMenuPosition(constraints);
      // Should be positioned at: viewportWidth - menuWidth - margin
      expect(result.left).toBe(800 - 300 - 10); // 490
    });

    it('should adjust top position when menu overflows bottom edge', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 800,
        viewportHeight: 600,
        menuWidth: 200,
        menuHeight: 300,
        clickX: 100,
        clickY: 500,
        margin: 10,
      };
      
      const result = calculateContextMenuPosition(constraints);
      // Should be positioned at: viewportHeight - menuHeight - margin
      expect(result.top).toBe(600 - 300 - 10); // 290
    });

    it('should ensure minimum left margin is respected', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 300,
        viewportHeight: 600,
        menuWidth: 400, // Larger than viewport
        menuHeight: 200,
        clickX: 50,
        clickY: 100,
        margin: 10,
      };
      
      const result = calculateContextMenuPosition(constraints);
      expect(result.left).toBe(10); // minimum margin
    });

    it('should ensure minimum top margin is respected', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 800,
        viewportHeight: 300,
        menuWidth: 200,
        menuHeight: 400, // Larger than viewport
        clickX: 100,
        clickY: 50,
        margin: 10,
      };
      
      const result = calculateContextMenuPosition(constraints);
      expect(result.top).toBe(10); // minimum margin
    });

    it('should use default margin of 10 when not specified', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 800,
        viewportHeight: 600,
        menuWidth: 200,
        menuHeight: 300,
        clickX: 750, // Would overflow with margin 0, but not with margin 10
        clickY: 550,
      };
      
      const result = calculateContextMenuPosition(constraints);
      // With default margin 10, 750 + 200 = 950 > 800 - 10 = 790, so it should adjust
      expect(result.left).toBeLessThan(750);
      expect(result.top).toBeLessThan(550);
    });

    it('should handle click at exact right edge with margin', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 800,
        viewportHeight: 600,
        menuWidth: 100,
        menuHeight: 100,
        clickX: 700, // 700 + 100 = 800, exactly at edge without margin
        clickY: 100,
        margin: 10,
      };
      
      const result = calculateContextMenuPosition(constraints);
      // 700 + 100 = 800 which equals viewportWidth - margin (800 - 10 = 790)?
      // Actually 800 > 790, so it should adjust
      expect(result.left).toBe(800 - 100 - 10); // 690
    });

    it('should handle click at exact bottom edge with margin', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 800,
        viewportHeight: 600,
        menuWidth: 100,
        menuHeight: 100,
        clickX: 100,
        clickY: 500, // 500 + 100 = 600, exactly at edge
        margin: 10,
      };
      
      const result = calculateContextMenuPosition(constraints);
      // 500 + 100 = 600 > viewportHeight - margin (600 - 10 = 590)
      expect(result.top).toBe(600 - 100 - 10); // 490
    });

    it('should handle very small viewport', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 100,
        viewportHeight: 100,
        menuWidth: 80,
        menuHeight: 80,
        clickX: 50,
        clickY: 50,
        margin: 5,
      };
      
      const result = calculateContextMenuPosition(constraints);
      expect(result.left).toBeGreaterThanOrEqual(5);
      expect(result.top).toBeGreaterThanOrEqual(5);
      expect(result.left).toBeLessThanOrEqual(100 - 80 - 5);
      expect(result.top).toBeLessThanOrEqual(100 - 80 - 5);
    });

    it('should handle zero dimensions gracefully', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 100,
        viewportHeight: 100,
        menuWidth: 0,
        menuHeight: 0,
        clickX: 50,
        clickY: 50,
        margin: 10,
      };
      
      const result = calculateContextMenuPosition(constraints);
      expect(result.left).toBe(50);
      expect(result.top).toBe(50);
    });

    it('should adjust both axes when needed', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 400,
        viewportHeight: 400,
        menuWidth: 200,
        menuHeight: 200,
        clickX: 350,
        clickY: 350,
        margin: 10,
      };

      const result = calculateContextMenuPosition(constraints);
      // Both axes should be adjusted
      expect(result.left).toBe(400 - 200 - 10); // 190
      expect(result.top).toBe(400 - 200 - 10); // 190
    });

    it('should respect boundaryRight when menu overflows it', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 1920,
        viewportHeight: 1080,
        menuWidth: 200,
        menuHeight: 300,
        clickX: 250,
        clickY: 100,
        margin: 10,
        boundaryRight: 314, // sidebar right edge (64 + 250)
      };

      const result = calculateContextMenuPosition(constraints);
      // 250 + 200 = 450 > 314 - 10 = 304, so must adjust
      expect(result.left).toBe(314 - 200 - 10); // 104
      expect(result.top).toBe(100);
    });

    it('should not adjust when menu fits within boundaryRight', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 1920,
        viewportHeight: 1080,
        menuWidth: 200,
        menuHeight: 300,
        clickX: 50,
        clickY: 100,
        margin: 10,
        boundaryRight: 314,
      };

      const result = calculateContextMenuPosition(constraints);
      // 50 + 200 = 250 < 314 - 10 = 304, fits fine
      expect(result.left).toBe(50);
      expect(result.top).toBe(100);
    });

    it('should use viewport width when boundaryRight exceeds it', () => {
      const constraints: ViewportConstraints = {
        viewportWidth: 800,
        viewportHeight: 600,
        menuWidth: 200,
        menuHeight: 200,
        clickX: 700,
        clickY: 100,
        margin: 10,
        boundaryRight: 2000, // larger than viewport
      };

      const result = calculateContextMenuPosition(constraints);
      // should use viewport (800) since it's the tighter limit
      expect(result.left).toBe(800 - 200 - 10); // 590
    });
  });

  describe('shouldPositionLeft', () => {
    it('should return false when menu fits to the right', () => {
      expect(shouldPositionLeft(100, 200, 800, 10)).toBe(false);
      expect(shouldPositionLeft(400, 200, 800, 10)).toBe(false);
    });

    it('should return true when menu would overflow right edge', () => {
      expect(shouldPositionLeft(700, 200, 800, 10)).toBe(true);
      expect(shouldPositionLeft(600, 250, 800, 10)).toBe(true);
    });

    it('should handle exact edge case', () => {
      // 600 + 190 = 790 which equals 800 - 10
      expect(shouldPositionLeft(600, 190, 800, 10)).toBe(false);
      // 600 + 200 = 800 which is > 800 - 10 = 790
      expect(shouldPositionLeft(600, 200, 800, 10)).toBe(true);
    });

    it('should use default margin of 10', () => {
      expect(shouldPositionLeft(690, 100, 800)).toBe(false); // 690 + 100 = 790, 800 - 10 = 790
      expect(shouldPositionLeft(700, 91, 800)).toBe(true); // 700 + 91 = 791 > 790
    });

    it('should handle zero click position', () => {
      expect(shouldPositionLeft(0, 200, 800, 10)).toBe(false);
    });

    it('should handle custom margins', () => {
      expect(shouldPositionLeft(700, 95, 800, 5)).toBe(false); // 700 + 95 = 795, 800 - 5 = 795
      expect(shouldPositionLeft(700, 96, 800, 5)).toBe(true); // 700 + 96 = 796 > 795
    });
  });

  describe('shouldPositionAbove', () => {
    it('should return false when menu fits below', () => {
      expect(shouldPositionAbove(100, 200, 600, 10)).toBe(false);
      expect(shouldPositionAbove(300, 200, 600, 10)).toBe(false);
    });

    it('should return true when menu would overflow bottom edge', () => {
      expect(shouldPositionAbove(500, 200, 600, 10)).toBe(true);
      expect(shouldPositionAbove(400, 250, 600, 10)).toBe(true);
    });

    it('should handle exact edge case', () => {
      // 400 + 190 = 590 which equals 600 - 10
      expect(shouldPositionAbove(400, 190, 600, 10)).toBe(false);
      // 400 + 200 = 600 which is > 600 - 10 = 590
      expect(shouldPositionAbove(400, 200, 600, 10)).toBe(true);
    });

    it('should use default margin of 10', () => {
      expect(shouldPositionAbove(500, 90, 600)).toBe(false); // 500 + 90 = 590, 600 - 10 = 590
      expect(shouldPositionAbove(500, 100, 600)).toBe(true); // 500 + 100 = 600 > 590
    });

    it('should handle zero click position', () => {
      expect(shouldPositionAbove(0, 200, 600, 10)).toBe(false);
    });

    it('should handle custom margins', () => {
      expect(shouldPositionAbove(500, 95, 600, 5)).toBe(false); // 500 + 95 = 595, 600 - 5 = 595
      expect(shouldPositionAbove(500, 96, 600, 5)).toBe(true); // 500 + 96 = 596 > 595
    });
  });

  describe('calculateSubmenuOffsetY', () => {
    it('returns 0 when the submenu fits below', () => {
      expect(calculateSubmenuOffsetY(100, 200, 800)).toBe(0);
    });

    it('returns 0 when the submenu ends exactly at the margin', () => {
      expect(calculateSubmenuOffsetY(590, 200, 800)).toBe(0);
    });

    it('shifts up by the bottom overflow', () => {
      // bottom = 700 + 200 = 900, limit = 800 - 10 → overflow 110
      expect(calculateSubmenuOffsetY(700, 200, 800)).toBe(-110);
    });

    it('never pushes the submenu top above the viewport margin', () => {
      // Overflow is 210 but only 40px of shift is available above.
      expect(calculateSubmenuOffsetY(50, 750, 600)).toBe(-40);
    });

    it('returns 0 when the submenu is taller than the viewport and already at the top', () => {
      expect(calculateSubmenuOffsetY(10, 1000, 600)).toBe(0);
    });

    it('respects a custom margin', () => {
      // bottom = 700 + 120 = 820, limit = 800 - 20 → overflow 40
      expect(calculateSubmenuOffsetY(700, 120, 800, 20)).toBe(-40);
    });
  });

  describe('clamp', () => {
    it('should return value when within range', () => {
      expect(clamp(50, 0, 100)).toBe(50);
      expect(clamp(0, 0, 100)).toBe(0);
      expect(clamp(100, 0, 100)).toBe(100);
    });

    it('should clamp to min when value is below range', () => {
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(-100, -50, 50)).toBe(-50);
    });

    it('should clamp to max when value is above range', () => {
      expect(clamp(150, 0, 100)).toBe(100);
      expect(clamp(100, -50, 50)).toBe(50);
    });

    it('should handle negative ranges', () => {
      expect(clamp(-75, -100, -50)).toBe(-75);
      expect(clamp(-150, -100, -50)).toBe(-100);
      expect(clamp(-25, -100, -50)).toBe(-50);
    });

    it('should handle zero as boundary', () => {
      expect(clamp(50, 0, 0)).toBe(0);
      expect(clamp(-10, 0, 100)).toBe(0);
    });

    it('should handle floating point values', () => {
      expect(clamp(3.14, 0, 5)).toBe(3.14);
      expect(clamp(10.5, 0, 5)).toBe(5);
      expect(clamp(-2.5, 0, 5)).toBe(0);
    });

    it('should handle equal min and max', () => {
      expect(clamp(5, 10, 10)).toBe(10);
      expect(clamp(15, 10, 10)).toBe(10);
    });
  });
});
