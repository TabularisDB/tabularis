import {afterEach, describe, expect, it} from 'vitest';
import {fitFrameHeight, frameScrollports} from '@/utils/pluginFrameFit';

const mount = (overflow: string, padding = '0px') => {
    const scrollport = document.createElement('div');
    scrollport.style.overflow = overflow;
    scrollport.style.padding = padding;
    const wrapper = document.createElement('div');
    const anchor = document.createElement('div');
    wrapper.append(anchor);
    scrollport.append(wrapper);
    document.body.append(scrollport);
    return {scrollport, anchor};
};
const clientHeight = (element: HTMLElement, value: number | (() => number)) =>
    Object.defineProperty(element, 'clientHeight', {
        configurable: true,
        get: typeof value === 'function' ? value : () => value,
    });

afterEach(() => {
    document.body.replaceChildren();
});

describe('pluginFrameFit', () => {
    describe('frameScrollports', () => {
        it('lists scroll containers nearest first and skips ancestors that only clip', () => {
            const outer = document.createElement('div');
            outer.style.overflowY = 'scroll';
            const clip = document.createElement('div');
            clip.style.overflow = 'hidden';
            const inner = document.createElement('div');
            inner.style.overflow = 'auto';
            const anchor = document.createElement('div');
            inner.append(anchor);
            clip.append(inner);
            outer.append(clip);
            document.body.append(outer);
            expect(frameScrollports(anchor)).toEqual([inner, outer]);
        });
    });

    describe('fitFrameHeight', () => {
        it('gives the content its full height when nothing scrolls around it', () => {
            const anchor = document.createElement('div');
            document.body.append(anchor);
            expect(fitFrameHeight(anchor, 900)).toBe(900);
        });

        it('caps a long form to one page of its scrollport, inside the padding', () => {
            const {scrollport, anchor} = mount('auto', '20px');
            clientHeight(scrollport, 620);
            expect(fitFrameHeight(anchor, 900)).toBe(580);
        });

        it('leaves content that fits the page alone', () => {
            const {scrollport, anchor} = mount('auto', '20px');
            clientHeight(scrollport, 620);
            expect(fitFrameHeight(anchor, 150)).toBe(150);
        });

        it('takes the smallest page of nested scrollports', () => {
            const {scrollport, anchor} = mount('auto');
            const outer = document.createElement('div');
            outer.style.overflow = 'auto';
            document.body.append(outer);
            outer.append(scrollport);
            clientHeight(scrollport, 700);
            clientHeight(outer, 400);
            expect(fitFrameHeight(anchor, 900)).toBe(400);
        });

        it('measures the room with the anchor at content height, not at its current one', () => {
            // An auto-height scrollport that grows with the anchor up to 300px.
            const {scrollport, anchor} = mount('auto');
            anchor.style.height = '100px';
            clientHeight(scrollport, () => Math.min(300, Number.parseFloat(anchor.style.height)));
            expect(fitFrameHeight(anchor, 500)).toBe(300);
            expect(anchor.style.height).toBe('100px');
        });

        it('ignores a scrollport that has no height yet', () => {
            const {scrollport, anchor} = mount('auto', '20px');
            clientHeight(scrollport, 0);
            expect(fitFrameHeight(anchor, 240)).toBe(240);
        });

        it('returns no height for empty or invalid content', () => {
            const {anchor} = mount('auto');
            expect(fitFrameHeight(anchor, 0)).toBe(0);
            expect(fitFrameHeight(anchor, -5)).toBe(0);
            expect(fitFrameHeight(anchor, Number.NaN)).toBe(0);
        });
    });
});
