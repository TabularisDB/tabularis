import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {PluginConnectionAction} from '@/components/plugins/PluginConnectionAction';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

describe('PluginConnectionAction', () => {
    it('renders a prominent branded action with readable foreground and activates it', () => {
        const open = vi.fn();
        render(
            <PluginConnectionAction
                providerName="Neon"
                label="Open Neon workspace"
                description="Cloud workspace"
                brandColor="#00e599"
                onClick={open}
            />,
        );
        const button = screen.getByRole('button', {name: 'Open Neon workspace'});
        expect(button).toHaveTextContent('Neon');
        expect(button).toHaveTextContent('Cloud workspace');
        expect(button).toHaveStyle({backgroundColor: '#00e599', color: '#000000'});
        fireEvent.click(button);
        expect(open).toHaveBeenCalledOnce();
    });
    it('uses the same core action for another provider and rejects invalid brand colors', () => {
        render(
            <PluginConnectionAction
                providerName="Appwrite"
                label="Open Appwrite services"
                brandColor="url(https://example.com)"
                onClick={vi.fn()}
                disabled
            />,
        );
        const button = screen.getByRole('button', {name: 'Open Appwrite services'});
        expect(button).toHaveTextContent('Appwrite');
        expect(button).toBeDisabled();
        expect(button.style.backgroundColor).not.toContain('url(');
    });
});
