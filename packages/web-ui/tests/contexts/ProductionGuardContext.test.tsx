import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useContext, type ReactNode} from 'react';
import {ProductionGuardProvider} from '@/contexts/ProductionGuardContext';
import {ProductionGuardContext, snoozedConnectionIds} from '@/hooks/useProductionGuard';

const settingsState = vi.hoisted(() => ({delayEnabled: false}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({
        settings: {
            safetyConfirmationDelayEnabled: settingsState.delayEnabled,
        },
    }),
}));

vi.mock('lucide-react', () => ({
    TriangleAlert: () => <span data-testid="warning-icon" />,
    X: () => <span data-testid="close-icon" />,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => (key === 'environment.warnConfirm' ? 'Run anyway' : key),
    }),
}));

vi.mock('@/components/ui/SqlPreview', () => ({
    SqlPreview: ({sql}: {sql: string}) => <div data-testid="sql-preview">{sql}</div>,
}));

vi.mock('@/components/ui/Modal', () => ({
    Modal: ({isOpen, children}: {isOpen: boolean; children: ReactNode}) =>
        isOpen ? <div>{children}</div> : null,
}));

function GuardRequester() {
    const request = useContext(ProductionGuardContext);

    return (
        <button
            onClick={() => {
                void request?.('prod-id', 'Production', 'DROP TABLE users');
            }}
        >
            Request confirmation
        </button>
    );
}

function TwoWriters({onAnswer}: {onAnswer: (connectionId: string, ok: boolean) => void}) {
    const request = useContext(ProductionGuardContext);

    return (
        <button
            onClick={() => {
                void request?.('billing', 'Billing', 'DELETE FROM invoices').then((ok) => {
                    onAnswer('billing', ok);
                });
                void request?.('orders', 'Orders', 'DELETE FROM shipments').then((ok) => {
                    onAnswer('orders', ok);
                });
            }}
        >
            Request both
        </button>
    );
}

describe('ProductionGuardProvider', () => {
    beforeEach(() => {
        settingsState.delayEnabled = false;
        vi.useFakeTimers();
    });

    afterEach(() => {
        snoozedConnectionIds.clear();
        vi.useRealTimers();
    });

    it('allows immediate confirmation when the safety delay is disabled', () => {
        render(
            <ProductionGuardProvider>
                <GuardRequester />
            </ProductionGuardProvider>,
        );

        fireEvent.click(screen.getByRole('button', {name: 'Request confirmation'}));

        expect(screen.getByRole('button', {name: 'Run anyway'})).not.toBeDisabled();
    });

    it('counts down production confirmation when the safety delay is enabled', () => {
        settingsState.delayEnabled = true;
        render(
            <ProductionGuardProvider>
                <GuardRequester />
            </ProductionGuardProvider>,
        );

        fireEvent.click(screen.getByRole('button', {name: 'Request confirmation'}));
        expect(screen.getByRole('button', {name: 'Run anyway (5)'})).toBeDisabled();

        for (let second = 0; second < 5; second += 1) {
            act(() => {
                vi.advanceTimersByTime(1000);
            });
        }

        expect(screen.getByRole('button', {name: 'Run anyway'})).not.toBeDisabled();
    });

    it('asks for each queued write and keeps the first answer attached to it', async () => {
        const answers: Array<[string, boolean]> = [];
        render(
            <ProductionGuardProvider>
                <TwoWriters
                    onAnswer={(connectionId, ok) => {
                        answers.push([connectionId, ok]);
                    }}
                />
            </ProductionGuardProvider>,
        );

        fireEvent.click(screen.getByRole('button', {name: 'Request both'}));
        expect(screen.getByTestId('sql-preview')).toHaveTextContent('DELETE FROM invoices');
        expect(answers).toEqual([]);

        fireEvent.click(screen.getByRole('button', {name: 'Run anyway'}));
        await act(async () => {
            await Promise.resolve();
        });
        expect(answers).toEqual([['billing', true]]);
        expect(screen.getByTestId('sql-preview')).toHaveTextContent('DELETE FROM shipments');

        fireEvent.click(screen.getByRole('button', {name: 'common.cancel'}));
        await act(async () => {
            await Promise.resolve();
        });
        expect(answers).toEqual([
            ['billing', true],
            ['orders', false],
        ]);
        expect(screen.queryByTestId('sql-preview')).not.toBeInTheDocument();
    });

    it('lets a snoozed connection skip a prompt that is already waiting', async () => {
        const answers: Array<[string, boolean]> = [];
        const requestRef: {current: ReturnType<typeof useContext<typeof ProductionGuardContext>>} =
            {current: null};

        function SameConnection() {
            requestRef.current = useContext(ProductionGuardContext);
            return null;
        }

        render(
            <ProductionGuardProvider>
                <SameConnection />
            </ProductionGuardProvider>,
        );

        act(() => {
            void requestRef.current?.('billing', 'Billing', 'DELETE FROM invoices').then((ok) => {
                answers.push(['first', ok]);
            });
            void requestRef.current?.('billing', 'Billing', 'DELETE FROM payments').then((ok) => {
                answers.push(['second', ok]);
            });
            void requestRef.current?.('orders', 'Orders', 'DELETE FROM shipments').then((ok) => {
                answers.push(['orders', ok]);
            });
        });

        expect(screen.getByTestId('sql-preview')).toHaveTextContent('DELETE FROM invoices');
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', {name: 'Run anyway'}));
        await act(async () => {
            await Promise.resolve();
        });

        expect(answers).toEqual([
            ['first', true],
            ['second', true],
        ]);
        expect(screen.getByTestId('sql-preview')).toHaveTextContent('DELETE FROM shipments');
        expect(snoozedConnectionIds.has('billing')).toBe(true);
    });
});
