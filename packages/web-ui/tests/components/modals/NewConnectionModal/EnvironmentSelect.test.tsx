import {useState} from 'react';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {EnvironmentSelect} from '@/components/modals/NewConnectionModal/EnvironmentSelect';

function Form({save}: {save: (value: string) => void}) {
    const [value, setValue] = useState('development');
    return (
        <>
            <EnvironmentSelect value={value} onChange={setValue} />
            <button onClick={() => save(value)}>Save connection</button>
        </>
    );
}

describe('EnvironmentSelect', () => {
    it('selects an environment and saves on the next click', async () => {
        const user = userEvent.setup();
        const save = vi.fn();
        render(<Form save={save} />);
        await user.click(screen.getByRole('button', {name: 'environment.label'}));
        await user.click(screen.getByRole('option', {name: 'environment.production'}));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', {name: 'Save connection'}));
        expect(save).toHaveBeenCalledExactlyOnceWith('production');
    });

    it('closes outside while allowing the same click to save', async () => {
        const user = userEvent.setup();
        const save = vi.fn();
        render(<Form save={save} />);
        await user.click(screen.getByRole('button', {name: 'environment.label'}));
        await user.click(screen.getByRole('button', {name: 'Save connection'}));
        expect(save).toHaveBeenCalledExactlyOnceWith('development');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes with Escape without changing the selection', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<EnvironmentSelect value="staging" onChange={onChange} />);
        const trigger = screen.getByRole('button', {name: 'environment.label'});
        await user.click(trigger);
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(onChange).not.toHaveBeenCalled();
        await user.click(trigger);
        expect(screen.getByRole('option', {name: 'environment.staging'})).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });
});
