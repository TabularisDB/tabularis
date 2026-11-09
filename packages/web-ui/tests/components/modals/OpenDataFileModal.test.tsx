import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {OpenDataFileModal} from '@/components/modals/OpenDataFileModal';

vi.mock('@/components/ui/Modal', () => ({
    Modal: ({
        isOpen,
        onClose,
        children,
    }: {
        isOpen: boolean;
        onClose: () => void;
        children: React.ReactNode;
    }) =>
        isOpen ? (
            <div data-testid="modal">
                <button type="button" data-testid="escape" onClick={onClose} />
                {children}
            </div>
        ) : null,
}));

const files = [
    {name: 'orders.csv', reference: '/data/orders.csv'},
    {name: 'events.ndjson', reference: '/data/events.ndjson'},
];

function renderModal(stage: React.ComponentProps<typeof OpenDataFileModal>['stage']) {
    const onClose = vi.fn();
    const onInstall = vi.fn();
    render(
        <OpenDataFileModal
            isOpen
            onClose={onClose}
            stage={stage}
            pluginName="DuckDB"
            onInstall={onInstall}
        />,
    );
    return {onClose, onInstall};
}

describe('OpenDataFileModal', () => {
    it('lists the files and offers to install the plugin they need', () => {
        const {onClose, onInstall} = renderModal({kind: 'plugin-required', files});

        expect(screen.getByRole('dialog', {name: 'dataFiles.open'})).toBeInTheDocument();
        expect(screen.getByText('orders.csv')).toBeInTheDocument();
        expect(screen.getByText('events.ndjson')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('dataFiles.pluginRequired');

        fireEvent.click(screen.getByRole('button', {name: 'dataFiles.installAndOpen'}));
        expect(onInstall).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', {name: 'common.cancel'}));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['installing', 'dataFiles.installing'],
        ['opening', 'dataFiles.opening'],
    ] as const)('cannot be closed while %s', (kind, message) => {
        const {onClose} = renderModal(
            kind === 'opening' ? {kind, files, quiet: false} : {kind, files},
        );

        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('status')).toHaveTextContent(message);
        expect(screen.queryByRole('button', {name: 'dataFiles.installAndOpen'})).toBeNull();
        for (const button of screen.getAllByRole('button', {name: 'common.close'})) {
            expect(button).toBeDisabled();
        }

        fireEvent.click(screen.getByTestId('escape'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows a failure and only offers a retry when the install failed', () => {
        const {onClose} = renderModal({kind: 'error', files, message: 'malformed CSV'});

        expect(screen.getByRole('alert')).toHaveTextContent('dataFiles.failed');
        expect(screen.getByRole('alert')).toHaveTextContent('malformed CSV');
        expect(screen.queryByRole('button', {name: 'dataFiles.installAndOpen'})).toBeNull();

        fireEvent.click(screen.getByTestId('escape'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('offers to try the install again after it failed', () => {
        const {onInstall} = renderModal({
            kind: 'error',
            files,
            message: 'offline',
            retryInstall: true,
        });

        fireEvent.click(screen.getByRole('button', {name: 'dataFiles.installAndOpen'}));
        expect(onInstall).toHaveBeenCalledTimes(1);
    });
});
