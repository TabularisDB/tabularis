import {beforeEach, describe, expect, it, vi} from 'vitest';
import {act, fireEvent, render, screen} from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    open: vi.fn(),
    installAndOpen: vi.fn(),
    dismiss: vi.fn(),
    stage: {kind: 'idle'} as Record<string, unknown>,
    environment: 'browser' as 'tauri' | 'browser',
    drivers: [] as {id: string; name: string}[],
    registry: [] as {id: string; name: string}[],
}));

vi.mock('@/hooks/useOpenDataFile', () => ({
    useOpenDataFile: () => ({
        stage: mocks.stage,
        open: mocks.open,
        installAndOpen: mocks.installAndOpen,
        dismiss: mocks.dismiss,
    }),
}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({negotiation: {environment: mocks.environment}}),
}));
vi.mock('@/hooks/useDrivers', () => ({
    useDrivers: () => ({allDrivers: mocks.drivers}),
}));
vi.mock('@/hooks/usePluginRegistry', () => ({
    usePluginRegistry: () => ({plugins: mocks.registry}),
}));
vi.mock('@/components/modals/OpenDataFileModal', () => ({
    OpenDataFileModal: ({
        pluginName,
        onInstall,
        onClose,
    }: {
        pluginName: string;
        onInstall: () => void;
        onClose: () => void;
    }) => (
        <div data-testid="open-data-file-modal" data-plugin={pluginName}>
            <button type="button" onClick={onInstall}>
                install
            </button>
            <button type="button" onClick={onClose}>
                close
            </button>
        </div>
    ),
}));

import {DataFileGate} from '@/components/modals/DataFileGate';
import {requestOpenDataFiles} from '@/utils/dataFiles';

/** A drag event jsdom can dispatch; it has no DataTransfer constructor. */
function drag(type: string, dataTransfer: {types: string[]; files?: File[]}) {
    const event = new Event(type, {bubbles: true, cancelable: true});
    Object.defineProperty(event, 'dataTransfer', {value: dataTransfer});
    return event;
}

const overlay = () => screen.queryByText('dataFiles.dropTitle');

describe('DataFileGate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.stage = {kind: 'idle'};
        mocks.environment = 'browser';
        mocks.drivers = [];
        mocks.registry = [];
    });

    it('opens what the rest of the app asks for', () => {
        render(<DataFileGate />);
        const files = [{name: 'orders.csv', reference: '/data/orders.csv'}];

        act(() => requestOpenDataFiles());
        act(() => requestOpenDataFiles(files));

        // jsdom normalises an absent event detail to null.
        expect(mocks.open.mock.calls).toEqual([[null], [files]]);
    });

    it('stops listening once unmounted', () => {
        const {unmount} = render(<DataFileGate />);
        unmount();

        act(() => requestOpenDataFiles());

        expect(mocks.open).not.toHaveBeenCalled();
    });

    it('opens files dropped onto the browser window', () => {
        render(<DataFileGate />);
        expect(overlay()).toBeNull();

        const over = drag('dragover', {types: ['Files']});
        act(() => {
            window.dispatchEvent(over);
        });
        expect(over.defaultPrevented).toBe(true);
        expect(overlay()).not.toBeNull();

        const file = new File(['id\n1\n'], 'orders.csv');
        act(() => {
            screen
                .getByRole('presentation')
                .dispatchEvent(drag('drop', {types: ['Files'], files: [file]}));
        });

        expect(mocks.open).toHaveBeenCalledWith([{name: 'orders.csv', blob: file}]);
        expect(overlay()).toBeNull();
    });

    it('ignores in-app drags, which carry no files', () => {
        render(<DataFileGate />);

        const over = drag('dragover', {types: ['text/plain']});
        act(() => {
            window.dispatchEvent(over);
        });

        expect(over.defaultPrevented).toBe(false);
        expect(overlay()).toBeNull();
    });

    it('hides the drop target when the drag leaves the window', () => {
        render(<DataFileGate />);
        act(() => {
            window.dispatchEvent(drag('dragover', {types: ['Files']}));
        });

        fireEvent.dragLeave(screen.getByRole('presentation'));

        expect(overlay()).toBeNull();
        expect(mocks.open).not.toHaveBeenCalled();
    });

    it('does not take drops on desktop, where dropped files have no path', () => {
        mocks.environment = 'tauri';
        render(<DataFileGate />);

        const over = drag('dragover', {types: ['Files']});
        act(() => {
            window.dispatchEvent(over);
        });

        expect(over.defaultPrevented).toBe(false);
        expect(overlay()).toBeNull();
    });

    it('shows the dialog for every stage except a quiet open', () => {
        mocks.stage = {kind: 'opening', files: [], quiet: true};
        const {rerender} = render(<DataFileGate />);
        expect(screen.queryByTestId('open-data-file-modal')).toBeNull();

        mocks.stage = {kind: 'opening', files: [], quiet: false};
        rerender(<DataFileGate />);
        expect(screen.getByTestId('open-data-file-modal')).toBeInTheDocument();

        mocks.stage = {kind: 'plugin-required', files: []};
        rerender(<DataFileGate />);
        fireEvent.click(screen.getByText('install'));
        fireEvent.click(screen.getByText('close'));

        expect(mocks.installAndOpen).toHaveBeenCalledTimes(1);
        expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    });

    it('names the plugin from the installed driver, then the registry, then its id', () => {
        mocks.stage = {kind: 'plugin-required', files: []};
        const pluginName = () =>
            screen.getByTestId('open-data-file-modal').getAttribute('data-plugin');
        const {rerender} = render(<DataFileGate />);
        expect(pluginName()).toBe('duckdb');

        mocks.registry = [{id: 'duckdb', name: 'DuckDB (registry)'}];
        rerender(<DataFileGate />);
        expect(pluginName()).toBe('DuckDB (registry)');

        mocks.drivers = [{id: 'duckdb', name: 'DuckDB'}];
        rerender(<DataFileGate />);
        expect(pluginName()).toBe('DuckDB');
    });
});
