import { describe, it, expect } from 'vitest';
import {
  computeDropdownPosition,
  dropdownPositionStyle,
  DROPDOWN_MAX_HEIGHT,
  DROPDOWN_GAP,
  VIEWPORT_MARGIN,
} from '../../src/utils/dropdownPosition';

const VIEWPORT = 800;

const rect = (top: number, height = 36, left = 100, width = 200) => ({
  top,
  bottom: top + height,
  left,
  width,
});

describe('computeDropdownPosition', () => {
  it('opens downward with full max height when there is plenty of space below', () => {
    const pos = computeDropdownPosition(rect(100), VIEWPORT);
    expect(pos.openUp).toBe(false);
    expect(pos.top).toBe(136 + DROPDOWN_GAP);
    expect(pos.maxHeight).toBe(DROPDOWN_MAX_HEIGHT);
    expect(pos.left).toBe(100);
    expect(pos.width).toBe(200);
  });

  it('clamps max height to the space below when the panel would overflow the viewport', () => {
    const pos = computeDropdownPosition(rect(600), VIEWPORT);
    expect(pos.openUp).toBe(false);
    const spaceBelow = VIEWPORT - 636 - DROPDOWN_GAP - VIEWPORT_MARGIN;
    expect(pos.maxHeight).toBe(spaceBelow);
    expect(pos.maxHeight).toBeLessThan(DROPDOWN_MAX_HEIGHT);
  });

  it('flips upward when the space below is too small and above is roomier', () => {
    const pos = computeDropdownPosition(rect(700), VIEWPORT);
    expect(pos.openUp).toBe(true);
    expect(pos.top).toBe(700 - DROPDOWN_GAP);
    expect(pos.maxHeight).toBe(DROPDOWN_MAX_HEIGHT);
  });

  it('clamps the flipped panel to the space above the trigger', () => {
    const pos = computeDropdownPosition(rect(150, 36), 220);
    expect(pos.openUp).toBe(true);
    const spaceAbove = 150 - DROPDOWN_GAP - VIEWPORT_MARGIN;
    expect(pos.maxHeight).toBe(spaceAbove);
  });

  it('stays below when both sides are tight but below is larger', () => {
    const pos = computeDropdownPosition(rect(40, 36), 200);
    expect(pos.openUp).toBe(false);
    const spaceBelow = 200 - 76 - DROPDOWN_GAP - VIEWPORT_MARGIN;
    expect(pos.maxHeight).toBe(spaceBelow);
  });

  it('never returns a negative max height', () => {
    const pos = computeDropdownPosition(rect(0, 200), 200);
    expect(pos.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it('respects a custom max height', () => {
    const pos = computeDropdownPosition(rect(100), VIEWPORT, 120);
    expect(pos.maxHeight).toBe(120);
  });
});

describe('dropdownPositionStyle', () => {
  it('anchors with top when opening downward', () => {
    const pos = computeDropdownPosition(rect(100), VIEWPORT);
    const style = dropdownPositionStyle(pos, VIEWPORT);
    expect(style).toEqual({
      top: pos.top,
      left: 100,
      width: 200,
      maxHeight: DROPDOWN_MAX_HEIGHT,
    });
  });

  it('anchors with bottom when flipped upward so the panel grows up', () => {
    const pos = computeDropdownPosition(rect(700), VIEWPORT);
    const style = dropdownPositionStyle(pos, VIEWPORT);
    expect(style.bottom).toBe(VIEWPORT - (700 - DROPDOWN_GAP));
    expect(style.top).toBeUndefined();
    expect(style.maxHeight).toBe(pos.maxHeight);
  });
});
