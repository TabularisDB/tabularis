import {describe, expect, it, vi} from 'vitest';
import {openNativePicker} from '@/utils/nativePicker';

const dateInput = () => {
    const input = document.createElement('input');
    input.type = 'date';
    return input;
};

describe('openNativePicker', () => {
    it('opens the picker when the engine supports it', () => {
        const input = dateInput();
        const showPicker = vi.fn();
        input.showPicker = showPicker;

        openNativePicker(input);

        expect(showPicker).toHaveBeenCalledTimes(1);
    });

    it('does nothing when showPicker is missing', () => {
        const input = dateInput();
        // Older engines have no showPicker at all.
        Object.defineProperty(input, 'showPicker', {value: undefined});

        expect(() => openNativePicker(input)).not.toThrow();
    });

    it('swallows the error thrown outside a user gesture or on a disabled input', () => {
        const input = dateInput();
        input.showPicker = vi.fn(() => {
            throw new DOMException('Not allowed', 'NotAllowedError');
        });

        expect(() => openNativePicker(input)).not.toThrow();
    });
});
