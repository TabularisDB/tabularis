import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AiApprovalGate} from '@/components/modals/AiApprovalGate';
import {usePendingApprovals} from '@/hooks/useAiActivity';
import {useSettings} from '@/hooks/useSettings';
import {
    focusWindowForApproval,
    notifyApprovalRequest,
    restoreWindowAlwaysOnTop,
} from '@/utils/mcpApprovalAttention';

const platform = vi.hoisted(() => ({notify: vi.fn()}));

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => platform,
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: vi.fn(),
}));

vi.mock('@/hooks/useAiActivity', () => ({
    usePendingApprovals: vi.fn(),
}));

vi.mock('@/utils/mcpApprovalAttention', () => ({
    focusWindowForApproval: vi.fn().mockResolvedValue(undefined),
    notifyApprovalRequest: vi.fn().mockResolvedValue(undefined),
    restoreWindowAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
}));

const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({showToast}),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) =>
            options ? `${key} ${JSON.stringify(options)}` : key,
    }),
}));

vi.mock('@/components/modals/AiApprovalModal', () => ({
    AiApprovalModal: ({
        approval,
        onDeny,
    }: {
        approval: {id: string};
        onDeny: (reason?: string) => Promise<void>;
    }) => (
        <div data-testid="approval-modal">
            {approval.id}
            <button onClick={() => void onDeny()}>deny</button>
        </div>
    ),
}));

describe('AiApprovalGate', () => {
    const decide = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(usePendingApprovals).mockReturnValue({
            pending: [
                {
                    id: 'approval-1',
                    query: 'SELECT 1',
                },
            ] as never[],
            loading: false,
            error: null,
            refetch: vi.fn(),
            decide,
        });
    });

    it('renders approval UI and sends notifications even before language settles', async () => {
        vi.mocked(useSettings).mockReturnValue({
            settings: {
                mcpApprovalAlwaysOnTop: true,
                mcpApprovalNotifySound: true,
            },
            isLoading: false,
            isLanguageReady: false,
            isLanguageSettled: false,
            updateSetting: vi.fn(),
        } as never);

        render(<AiApprovalGate />);

        await waitFor(() => {
            expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
        });

        expect(focusWindowForApproval).toHaveBeenCalledWith('approval-1');
        expect(notifyApprovalRequest).toHaveBeenCalledWith(
            {
                title: 'aiApproval.notificationTitle',
                body: 'aiApproval.notificationBody',
            },
            platform,
        );
        expect(restoreWindowAlwaysOnTop).not.toHaveBeenCalled();
    });

    it('restores temporary attention state when the active approval disappears before language settles', async () => {
        vi.mocked(useSettings)
            .mockReturnValueOnce({
                settings: {
                    mcpApprovalAlwaysOnTop: true,
                    mcpApprovalNotifySound: true,
                },
                isLoading: false,
                isLanguageReady: true,
                isLanguageSettled: true,
                updateSetting: vi.fn(),
            } as never)
            .mockReturnValueOnce({
                settings: {
                    mcpApprovalAlwaysOnTop: true,
                    mcpApprovalNotifySound: true,
                },
                isLoading: false,
                isLanguageReady: false,
                isLanguageSettled: false,
                updateSetting: vi.fn(),
            } as never);

        const {rerender} = render(<AiApprovalGate />);

        await waitFor(() => {
            expect(focusWindowForApproval).toHaveBeenCalledWith('approval-1');
        });

        vi.mocked(usePendingApprovals).mockReturnValue({
            pending: [] as never[],
            loading: false,
            error: null,
            refetch: vi.fn(),
            decide,
        });

        rerender(<AiApprovalGate />);

        await waitFor(() => {
            expect(restoreWindowAlwaysOnTop).toHaveBeenCalledWith('approval-1');
        });
    });

    it('does not steal focus when always-on-top attention is disabled', async () => {
        vi.mocked(useSettings).mockReturnValue({
            settings: {
                mcpApprovalAlwaysOnTop: false,
                mcpApprovalNotifySound: true,
            },
            isLoading: false,
            isLanguageReady: true,
            isLanguageSettled: true,
            updateSetting: vi.fn(),
        } as never);

        render(<AiApprovalGate />);

        await waitFor(() => {
            expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
        });

        expect(focusWindowForApproval).not.toHaveBeenCalled();
        expect(notifyApprovalRequest).toHaveBeenCalledWith(
            {
                title: 'aiApproval.notificationTitle',
                body: 'aiApproval.notificationBody',
            },
            platform,
        );
    });

    it('does not send notifications when notification attention is disabled', async () => {
        vi.mocked(useSettings).mockReturnValue({
            settings: {
                mcpApprovalAlwaysOnTop: true,
                mcpApprovalNotifySound: false,
            },
            isLoading: false,
            isLanguageReady: true,
            isLanguageSettled: true,
            updateSetting: vi.fn(),
        } as never);

        render(<AiApprovalGate />);

        await waitFor(() => {
            expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
        });

        expect(focusWindowForApproval).toHaveBeenCalledWith('approval-1');
        expect(notifyApprovalRequest).not.toHaveBeenCalled();
    });

    it('reports a decision that fails instead of rejecting silently', async () => {
        vi.mocked(useSettings).mockReturnValue({
            settings: {
                mcpApprovalAlwaysOnTop: false,
                mcpApprovalNotifySound: false,
            },
            isLoading: false,
            isLanguageReady: true,
            isLanguageSettled: true,
            updateSetting: vi.fn(),
        } as never);
        decide.mockRejectedValueOnce('The pending AI approval no longer exists');

        render(<AiApprovalGate />);
        fireEvent.click(await screen.findByRole('button', {name: 'deny'}));

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith(
                'aiApproval.decisionFailed {"error":"The pending AI approval no longer exists"}',
                {kind: 'error'},
            );
        });
    });
});
