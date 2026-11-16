import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {McpPage} from '@/pages/McpPage';

const mocks = vi.hoisted(() => {
    const call = vi.fn();
    return {
        call,
        client: {call},
        showAlert: vi.fn(),
    };
});

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => mocks.client,
}));

vi.mock('@/hooks/useAlert', () => ({
    useAlert: () => ({showAlert: mocks.showAlert}),
}));

vi.mock('@/hooks/useEditorTheme', () => ({
    useEditorTheme: () => ({id: 'tabularis-dark'}),
}));

vi.mock('@/components/settings/AiActivityPanel', () => ({
    AiActivityPanel: () => null,
}));

vi.mock('@/components/modals/mcp/McpSafetySection', () => ({
    McpSafetySection: () => null,
}));

describe('McpPage transport parity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.call.mockImplementation((command: string) => {
            if (command === 'get_mcp_status') {
                return Promise.resolve([
                    {
                        client_id: 'claude',
                        client_name: 'Claude Desktop',
                        installed: false,
                        config_path: '/home/test/.config/Claude/claude_desktop_config.json',
                        executable_path: '/usr/bin/tabularis',
                        client_type: 'file',
                        manual_command: null,
                    },
                ]);
            }
            if (command === 'install_mcp_config') {
                return Promise.resolve('Claude Desktop');
            }
            return Promise.reject(new Error(`Unexpected command: ${command}`));
        });
    });

    it('loads host status and installs configuration through the shared client', async () => {
        render(<McpPage />);

        await screen.findByText('Claude Desktop');
        expect(mocks.call).toHaveBeenCalledWith('get_mcp_status', undefined);

        fireEvent.click(screen.getByRole('button', {name: 'mcp.install'}));

        await waitFor(() => {
            expect(mocks.call).toHaveBeenCalledWith('install_mcp_config', {
                clientId: 'claude',
            });
            expect(mocks.showAlert).toHaveBeenCalled();
        });
    });
});
