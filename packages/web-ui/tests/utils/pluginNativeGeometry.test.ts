import {describe, expect, it, vi} from 'vitest';
import {getPluginNativeBounds} from '@/utils/pluginNativeGeometry';

describe('guest native projection geometry', () => {
    it('clips native tools to nested scrollports and identifies the active modal layer', () => {
        const scroll = document.createElement('div');
        scroll.style.overflow = 'auto';
        const source = document.createElement('div');
        scroll.append(source);
        document.body.append(scroll);
        vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(
            DOMRect.fromRect({x: 10, y: -20, width: 400, height: 250}),
        );
        vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(
            DOMRect.fromRect({x: 20, y: 40, width: 300, height: 100}),
        );
        Object.defineProperty(scroll, 'clientWidth', {value: 300});
        Object.defineProperty(scroll, 'clientHeight', {value: 100});
        expect(getPluginNativeBounds(source)).toEqual({
            modal: false,
            rect: {
                left: 10,
                top: -20,
                width: 400,
                height: 250,
                clip: {left: 10, right: 90, top: 60, bottom: 90},
            },
        });
        scroll.setAttribute('data-tabularis-guest-modal', 'true');
        expect(getPluginNativeBounds(source).modal).toBe(true);
        scroll.remove();
    });
    it('fully clips a hidden workspace so its native editor cannot overlay the active tab', () => {
        const hidden = document.createElement('div');
        hidden.style.overflow = 'hidden';
        const source = document.createElement('div');
        hidden.append(source);
        document.body.append(hidden);
        vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(
            DOMRect.fromRect({x: 0, y: 0, width: 300, height: 200}),
        );
        expect(getPluginNativeBounds(source).rect.clip).toEqual({
            left: 0,
            top: 0,
            right: 300,
            bottom: 200,
        });
        hidden.remove();
    });
});
