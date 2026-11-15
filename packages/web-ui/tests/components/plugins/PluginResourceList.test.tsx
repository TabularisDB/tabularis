import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {PluginResourceList} from '@/components/plugins/PluginResourceList';

describe('PluginResourceList', () => {
    it('opens the resource ID while showing its native label and status', () => {
        const onOpen = vi.fn();
        render(
            <PluginResourceList
                label="Functions"
                emptyMessage="Empty"
                onOpen={onOpen}
                items={[
                    {id: 'api', title: 'API function', subtitle: 'HTTP endpoint', status: 'Ready'},
                ]}
            />,
        );
        fireEvent.click(screen.getByRole('button', {name: 'API function'}));
        expect(onOpen).toHaveBeenCalledExactlyOnceWith('api');
        expect(screen.getByRole('list', {name: 'Functions'})).toBeInTheDocument();
    });
    it('shows an empty state without an actionable resource', () => {
        render(<PluginResourceList items={[]} onOpen={vi.fn()} emptyMessage="No functions yet" />);
        expect(screen.getByText('No functions yet')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
