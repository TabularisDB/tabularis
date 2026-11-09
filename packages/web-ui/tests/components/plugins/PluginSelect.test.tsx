import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {PluginSelect} from '@/components/plugins/PluginSelect';
import {Modal} from '@/components/ui/Modal';

describe('PluginSelect', () => {
    it('keeps option values separate from labels and supports the personal account value', () => {
        const change = vi.fn();
        render(
            <>
                <label htmlFor="provider-org">Organization</label>
                <PluginSelect
                    id="provider-org"
                    value=""
                    options={[
                        {value: '', label: 'Personal account'},
                        {value: 'org-1', label: 'My team'},
                    ]}
                    onChange={change}
                />
            </>,
        );
        const select = screen.getByRole('combobox', {name: 'Organization'});
        expect(select).toHaveDisplayValue('Personal account');
        fireEvent.click(select);
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('option', {name: 'My team'}));
        expect(change).toHaveBeenCalledWith('org-1');
    });

    it('searches option labels and descriptions and selects with the keyboard', () => {
        const change = vi.fn();
        render(
            <PluginSelect
                ariaLabel="Project"
                value="one"
                options={[
                    {value: 'one', label: 'Cloud', description: 'us-east-1'},
                    {value: 'two', label: 'Analytics', description: 'eu-central-1'},
                ]}
                onChange={change}
            />,
        );
        const select = screen.getByRole('combobox', {name: 'Project'});
        fireEvent.click(select);
        fireEvent.change(select, {target: {value: 'eu-central'}});
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option')).toHaveTextContent('Analytics');
        fireEvent.keyDown(select, {key: 'Enter'});
        expect(change).toHaveBeenCalledWith('two');
        expect(select).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes the selection before its parent modal on Escape', () => {
        const close = vi.fn();
        render(
            <Modal isOpen onClose={close}>
                <PluginSelect
                    ariaLabel="Project"
                    value="one"
                    options={[{value: 'one', label: 'Cloud'}]}
                    onChange={vi.fn()}
                />
            </Modal>,
        );
        const select = screen.getByRole('combobox', {name: 'Project'});
        fireEvent.keyDown(select, {key: 'ArrowDown'});
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.keyDown(select, {key: 'Escape'});
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(close).not.toHaveBeenCalled();
        fireEvent.keyDown(select, {key: 'Escape'});
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes an open menu while loading and announces the field-specific state', () => {
        const props = {
            ariaLabel: 'Project',
            value: '',
            options: [{value: 'one', label: 'Cloud'}],
            onChange: vi.fn(),
            placeholder: 'Choose a project',
        };
        const {rerender} = render(<PluginSelect {...props} />);
        fireEvent.click(screen.getByRole('combobox'));
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        rerender(<PluginSelect {...props} loading loadingLabel="Loading projects…" />);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Loading projects…');
        expect(screen.getByRole('combobox')).toBeDisabled();
        expect(screen.getByRole('combobox')).toHaveAttribute('aria-busy', 'true');
        rerender(<PluginSelect {...props} />);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', 'Choose a project');
    });

    it('exposes disabled prerequisites and associated instructions', () => {
        render(
            <>
                <p id="branch-help">Choose a project first</p>
                <PluginSelect
                    ariaLabel="Branch"
                    ariaDescribedBy="branch-help"
                    value=""
                    options={[{value: '', label: 'Choose a project first'}]}
                    disabled
                    onChange={vi.fn()}
                />
            </>,
        );
        const select = screen.getByRole('combobox', {name: 'Branch'});
        expect(select).toBeDisabled();
        expect(select).toHaveAccessibleDescription('Choose a project first');
    });
});
