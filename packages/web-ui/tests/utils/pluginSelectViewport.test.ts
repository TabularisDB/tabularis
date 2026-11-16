import {afterEach, describe, expect, it} from 'vitest';
import {pluginSelectPosition} from '@/utils/pluginSelectViewport';
import {computeDropdownPosition} from '@/utils/dropdownPosition';

afterEach(() => {
    document.documentElement.style.removeProperty('--tabularis-plugin-visible-top');
    document.documentElement.style.removeProperty('--tabularis-plugin-visible-bottom');
});
describe('provider select visible viewport', () => {
    it('uses the ordinary viewport outside sandbox frames', () => {
        const rect = {top: 100, bottom: 140, left: 20, width: 300};
        expect(pluginSelectPosition(rect)).toEqual(computeDropdownPosition(rect));
    });
    it('flips and limits options to the visible portion of a clipped iframe', () => {
        document.documentElement.style.setProperty('--tabularis-plugin-visible-top', '80px');
        document.documentElement.style.setProperty('--tabularis-plugin-visible-bottom', '360px');
        const position = pluginSelectPosition({top: 300, bottom: 340, left: 10, width: 300});
        expect(position.openUp).toBe(true);
        expect(position.top).toBe(296);
        expect(position.maxHeight).toBe(208);
        expect(position.top - position.maxHeight).toBeGreaterThanOrEqual(80);
    });
});
