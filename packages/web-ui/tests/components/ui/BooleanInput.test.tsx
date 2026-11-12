import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {BooleanInput} from '@/components/ui/BooleanInput';

describe('BooleanInput', () => {
    it.each([
        [null, true],
        [true, false],
        [false, null],
    ] as const)('cycles nullable %s to %s', (value, next) => {
        const onChange = vi.fn();
        render(<BooleanInput name="enabled" value={value} nullable onChange={onChange} />);
        const checkbox = screen.getByRole('checkbox', {name: 'enabled'});
        expect(checkbox).toHaveProperty('checked', value === true);
        expect(checkbox).toHaveProperty('indeterminate', value === null);
        fireEvent.click(checkbox);
        expect(onChange).toHaveBeenCalledWith(next);
    });

    it('toggles with Space without selecting the grid row', async () => {
        const onChange = vi.fn();
        const onKeyDown = vi.fn();
        render(
            <div onKeyDown={onKeyDown}>
                <BooleanInput name="enabled" value={false} onChange={onChange} />
            </div>,
        );
        const user = userEvent.setup();
        await user.tab();
        await user.keyboard(' ');
        expect(onChange).toHaveBeenCalledWith(true);
        expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('does not allow changes when disabled', () => {
        const onChange = vi.fn();
        render(<BooleanInput name="enabled" value={true} disabled onChange={onChange} />);
        expect(screen.getByRole('checkbox')).toBeDisabled();
    });
});
