import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {PluginSelect} from '@/components/plugins/PluginSelect';

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
        fireEvent.change(select, {target: {value: 'org-1'}});
        expect(change).toHaveBeenCalledWith('org-1');
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
