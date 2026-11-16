import {act, renderHook} from '@testing-library/react';
import type React from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useLockedColumnResize} from '@/hooks/useLockedColumnResize';

const MIN = 48;
const MAX = 2000;

describe('useLockedColumnResize', () => {
    let frames: FrameRequestCallback[];
    let table: HTMLTableElement;
    let handle: HTMLDivElement;

    const flushFrames = () => {
        const pending = frames;
        frames = [];
        pending.forEach((cb) => cb(0));
    };

    beforeEach(() => {
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            frames.push(cb);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        table = document.createElement('table');
        const colgroup = document.createElement('colgroup');
        [50, 100, 200].forEach((w) => {
            const col = document.createElement('col');
            col.style.width = `${w}px`;
            colgroup.appendChild(col);
        });
        table.appendChild(colgroup);
        handle = document.createElement('div');
        document.body.append(table, handle);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        table.remove();
        handle.remove();
    });

    const setup = (widths: number[] | null = [50, 100, 200]) => {
        const onResize = vi.fn();
        const tableRef = {current: table};
        const hook = renderHook(() =>
            useLockedColumnResize({
                tableRef,
                widths,
                minWidth: MIN,
                maxWidth: MAX,
                onResize,
            }),
        );
        return {...hook, onResize};
    };

    const mouseDown = (clientX: number, button = 0) => {
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();
        const event = {
            button,
            clientX,
            currentTarget: handle,
            preventDefault,
            stopPropagation,
        } as unknown as React.MouseEvent;
        return {event, preventDefault, stopPropagation};
    };

    const keyDown = (key: string, shiftKey = false) => {
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();
        const event = {
            key,
            shiftKey,
            preventDefault,
            stopPropagation,
        } as unknown as React.KeyboardEvent;
        return {event, preventDefault, stopPropagation};
    };

    const col = (index: number) => table.querySelectorAll('col')[index];

    it('paints the dragged width once per frame and commits it on mouse up', () => {
        const {result, onResize} = setup();
        const down = mouseDown(300);
        act(() => result.current.startResize(1, down.event));

        expect(down.preventDefault).toHaveBeenCalled();
        expect(down.stopPropagation).toHaveBeenCalled();
        expect(document.body.style.cursor).toBe('col-resize');

        window.dispatchEvent(new MouseEvent('mousemove', {clientX: 320}));
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: 340}));
        // Moves are coalesced into a single frame and nothing is committed yet.
        expect(frames).toHaveLength(1);
        expect(onResize).not.toHaveBeenCalled();
        flushFrames();

        expect(col(1).style.width).toBe('140px');
        expect(table.style.width).toBe('390px');
        expect(handle.getAttribute('aria-valuenow')).toBe('140');
        // Only the target column changes.
        expect(col(0).style.width).toBe('50px');
        expect(col(2).style.width).toBe('200px');

        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onResize).toHaveBeenCalledTimes(1);
        expect(onResize).toHaveBeenCalledWith(1, 140);
        expect(document.body.style.cursor).toBe('');
    });

    it('stops listening after mouse up', () => {
        const {result, onResize} = setup();
        act(() => result.current.startResize(1, mouseDown(300).event));
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: 310}));
        window.dispatchEvent(new MouseEvent('mouseup'));
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: 600}));
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onResize).toHaveBeenCalledTimes(1);
        expect(onResize).toHaveBeenCalledWith(1, 110);
    });

    it('clamps a drag to the minimum and maximum widths', () => {
        const {result, onResize} = setup();
        act(() => result.current.startResize(1, mouseDown(300).event));
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: -500}));
        flushFrames();
        expect(col(1).style.width).toBe(`${MIN}px`);
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onResize).toHaveBeenLastCalledWith(1, MIN);

        act(() => result.current.startResize(2, mouseDown(0).event));
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: 5000}));
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onResize).toHaveBeenLastCalledWith(2, MAX);
    });

    it('does not commit a press without movement', () => {
        const {result, onResize} = setup();
        act(() => result.current.startResize(1, mouseDown(300).event));
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onResize).not.toHaveBeenCalled();
    });

    it('cancels the drag with Escape and restores the width', () => {
        const {result, onResize} = setup();
        act(() => result.current.startResize(1, mouseDown(300).event));
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: 380}));
        flushFrames();
        expect(col(1).style.width).toBe('180px');

        window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
        expect(col(1).style.width).toBe('100px');
        expect(table.style.width).toBe('');
        expect(handle.getAttribute('aria-valuenow')).toBe('100');

        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onResize).not.toHaveBeenCalled();
    });

    it('ignores buttons other than the primary one', () => {
        const {result, onResize} = setup();
        const down = mouseDown(300, 2);
        act(() => result.current.startResize(1, down.event));
        expect(down.preventDefault).not.toHaveBeenCalled();
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: 400}));
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onResize).not.toHaveBeenCalled();
    });

    it('removes its listeners when unmounted mid-drag', () => {
        const {result, onResize, unmount} = setup();
        act(() => result.current.startResize(1, mouseDown(300).event));
        unmount();
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: 400}));
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onResize).not.toHaveBeenCalled();
        expect(document.body.style.cursor).toBe('');
    });

    it('does nothing before the widths are locked', () => {
        const {result, onResize} = setup(null);
        act(() => result.current.startResize(1, mouseDown(300).event));
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: 400}));
        window.dispatchEvent(new MouseEvent('mouseup'));
        const key = keyDown('ArrowRight');
        act(() => result.current.onResizeKeyDown(1, key.event));
        expect(onResize).not.toHaveBeenCalled();
        expect(key.preventDefault).not.toHaveBeenCalled();
    });

    describe('keyboard', () => {
        it('steps with the arrow keys and takes larger steps with Shift', () => {
            const {result, onResize} = setup();
            act(() => result.current.onResizeKeyDown(1, keyDown('ArrowRight').event));
            expect(onResize).toHaveBeenLastCalledWith(1, 110);
            act(() => result.current.onResizeKeyDown(1, keyDown('ArrowLeft').event));
            expect(onResize).toHaveBeenLastCalledWith(1, 90);
            act(() => result.current.onResizeKeyDown(1, keyDown('ArrowRight', true).event));
            expect(onResize).toHaveBeenLastCalledWith(1, 150);
        });

        it('jumps to the limits with Home and End', () => {
            const {result, onResize} = setup();
            act(() => result.current.onResizeKeyDown(2, keyDown('Home').event));
            expect(onResize).toHaveBeenLastCalledWith(2, MIN);
            act(() => result.current.onResizeKeyDown(2, keyDown('End').event));
            expect(onResize).toHaveBeenLastCalledWith(2, MAX);
        });

        it('keeps resize keys from reaching the grid', () => {
            const {result} = setup();
            const key = keyDown('ArrowLeft');
            act(() => result.current.onResizeKeyDown(1, key.event));
            expect(key.preventDefault).toHaveBeenCalled();
            expect(key.stopPropagation).toHaveBeenCalled();
        });

        it('leaves other keys alone', () => {
            const {result, onResize} = setup();
            const key = keyDown('ArrowDown');
            act(() => result.current.onResizeKeyDown(1, key.event));
            expect(onResize).not.toHaveBeenCalled();
            expect(key.preventDefault).not.toHaveBeenCalled();
            expect(key.stopPropagation).not.toHaveBeenCalled();
        });

        it('does not commit when already at a limit', () => {
            const {result, onResize} = setup([50, MIN, 200]);
            act(() => result.current.onResizeKeyDown(1, keyDown('ArrowLeft').event));
            act(() => result.current.onResizeKeyDown(1, keyDown('Home').event));
            expect(onResize).not.toHaveBeenCalled();
        });
    });
});
