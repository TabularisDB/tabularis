import {act, render} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ConnectionHealthMonitor} from '@/components/ConnectionHealthMonitor';

const mocks = vi.hoisted(() => ({
    client: {subscribe: vi.fn()},
    showAlert: vi.fn(),
    showToast: vi.fn(),
    navigate: vi.fn(),
    t: (key: string) => key,
}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => mocks.client}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: mocks.showAlert})}));
vi.mock('@/hooks/useToast', () => ({useToast: () => ({showToast: mocks.showToast})}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: mocks.t})}));
vi.mock('react-router-dom', () => ({useNavigate: () => mocks.navigate}));

function lifecycleHandler() {
    const call = mocks.client.subscribe.mock.calls.find(
        ([event]) => event === 'connection-lifecycle',
    );
    return call![1];
}

describe('ConnectionHealthMonitor transport events', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.client.subscribe.mockResolvedValue(vi.fn());
    });

    it('shows health failures from the active client and unsubscribes both listeners on unmount', async () => {
        const unsubscribe = vi.fn();
        mocks.client.subscribe.mockResolvedValue(unsubscribe);
        const view = render(<ConnectionHealthMonitor />);
        expect(mocks.client.subscribe).toHaveBeenCalledWith(
            'connection-health-failed',
            expect.any(Function),
        );
        const handler = mocks.client.subscribe.mock.calls[0][1];
        act(() => handler({connectionId: 'c1', error: 'connection closed'}));
        expect(mocks.showAlert).toHaveBeenCalledWith(
            'healthCheck.connectionLost: connection closed',
            expect.objectContaining({kind: 'error'}),
        );
        await act(async () => {
            view.unmount();
        });
        expect(unsubscribe).toHaveBeenCalledTimes(2);
    });

    it('shows a toast while a connection reconnects', () => {
        render(<ConnectionHealthMonitor />);
        act(() => lifecycleHandler()({connectionId: 'c1', state: 'reconnecting'}));
        expect(mocks.showToast).toHaveBeenCalledWith('healthCheck.reconnecting', {
            kind: 'warning',
        });
        expect(mocks.showAlert).not.toHaveBeenCalled();
    });

    it('confirms a reconnect that kept no sessions', () => {
        render(<ConnectionHealthMonitor />);
        act(() =>
            lifecycleHandler()({connectionId: 'c1', state: 'reconnected', releasedSessions: 0}),
        );
        expect(mocks.showToast).toHaveBeenCalledWith('healthCheck.reconnected', {
            kind: 'success',
        });
    });

    it('keeps a warning up when a reconnect reset query sessions', () => {
        render(<ConnectionHealthMonitor />);
        act(() =>
            lifecycleHandler()({connectionId: 'c1', state: 'reconnected', releasedSessions: 2}),
        );
        expect(mocks.showToast).toHaveBeenCalledWith('healthCheck.reconnectedSessionsReset', {
            kind: 'warning',
            duration: 0,
        });
    });
});
