import {fireEvent, screen} from '@testing-library/react';

/** Exercise the real host popup instead of synthesizing a native select change. */
export function selectOption(field: HTMLElement, value: string) {
    fireEvent.click(field);
    const option = screen.getAllByRole('option').find((item) => item.dataset.value === value);
    if (!option) throw new Error(`Selection option is missing: ${value}`);
    fireEvent.click(option);
}
