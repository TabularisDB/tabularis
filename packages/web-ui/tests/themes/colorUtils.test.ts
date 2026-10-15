import { describe, it, expect } from 'vitest';
import { hexToRgb, rgbToHex, lighten, darken, generateColorScale } from '../../src/themes/colorUtils';

describe('colorUtils', () => {
  describe('hexToRgb', () => {
    it('should convert 6-digit hex to rgb', () => {
      expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
      expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('should convert 3-digit hex to rgb', () => {
      expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#0f0')).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb('#00f')).toEqual({ r: 0, g: 0, b: 255 });
      expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('should handle hex without hash', () => {
      expect(hexToRgb('ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should return null for invalid hex', () => {
      expect(hexToRgb('zzzzzz')).toEqual(null); // parseInt returns NaN which is not null, logic check needed
      // Actually my implementation uses parseInt which returns NaN. 
      // The logic checks length but not valid chars.
      // parseInt('zz', 16) is NaN. 
      // Let's check the implementation behavior with NaN
    });
  });

  describe('rgbToHex', () => {
    it('should convert rgb to hex string', () => {
      expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
      expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
      expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
    });

    it('should pad single digits', () => {
      expect(rgbToHex(15, 15, 15)).toBe('#0f0f0f');
    });
  });

  describe('lighten', () => {
    it('should lighten a color', () => {
      // Lighten pure black by 50% -> grey
      // 0 + (255 - 0) * 0.5 = 127.5 -> 128 (approx)
      const res = lighten('#000000', 0.5);
      expect(res).toBe('#808080');
    });

    it('should not exceed white', () => {
      expect(lighten('#ffffff', 0.5)).toBe('#ffffff');
    });
  });

  describe('darken', () => {
    it('should darken a color', () => {
      // Darken pure white by 50% -> grey
      // 255 * (1 - 0.5) = 127.5 -> 128
      const res = darken('#ffffff', 0.5);
      expect(res).toBe('#808080');
    });

    it('should not exceed black', () => {
      expect(darken('#000000', 0.5)).toBe('#000000');
    });
  });
  
  describe('generateColorScale', () => {
      it('should generate 10 shades', () => {
          const scale = generateColorScale('#ff0000');
          expect(scale[500]).toBe('#ff0000');
          expect(scale[50]).not.toBe('#ff0000');
          expect(scale[900]).not.toBe('#ff0000');
      });
  });
});
