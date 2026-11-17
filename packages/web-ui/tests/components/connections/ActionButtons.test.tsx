import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {ActionButtons} from '@/components/connections/ActionButtons';
import {ConnectionCapabilitiesContext} from '@/contexts/ConnectionCapabilitiesContext';
import {STANDALONE_CONNECTION_CAPABILITIES, type ConnectionCapabilities} from '@/api/session';

vi.mock('lucide-react', async () => await vi.importActual('lucide-react'));

const MANAGED: ConnectionCapabilities = {
    managed: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    canDuplicate: false,
    canImport: false,
    canExport: false,
    canTest: false,
    canEditBranding: false,
    canEditOrganization: false,
};

function renderButtons(capabilities?: ConnectionCapabilities) {
    const handlers = {
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        onEdit: vi.fn(),
        onDuplicate: vi.fn(),
        onDelete: vi.fn(),
        onMigrate: vi.fn(),
    };
    const buttons = (
        <ActionButtons
            conn={{id: 'one', name: 'One', params: {driver: 'postgres', database: 'db'}}}
            isOpen={false}
            isDriverEnabled
            migrationDirection="to-plugin"
            {...handlers}
        />
    );
    render(
        capabilities ? (
            <ConnectionCapabilitiesContext.Provider value={capabilities}>
                {buttons}
            </ConnectionCapabilitiesContext.Provider>
        ) : (
            buttons
        ),
    );
    return handlers;
}

describe('ActionButtons', () => {
    it('shows every action outside managed mode', () => {
        renderButtons();

        for (const title of [
            'connections.connect',
            'connections.edit',
            'connections.clone',
            'connections.delete',
            'migration.switchToPlugin',
        ]) {
            expect(screen.getByTitle(title)).toBeInTheDocument();
        }
    });

    it('stays unchanged for the explicit standalone capabilities', () => {
        renderButtons(STANDALONE_CONNECTION_CAPABILITIES);

        expect(screen.getByTitle('connections.edit')).toBeInTheDocument();
    });

    it('keeps connecting but hides edit, clone, delete and migrate when managed', () => {
        const handlers = renderButtons(MANAGED);

        expect(screen.getByTitle('connections.connect')).toBeInTheDocument();
        for (const title of [
            'connections.edit',
            'connections.clone',
            'connections.delete',
            'migration.switchToPlugin',
        ]) {
            expect(screen.queryByTitle(title)).not.toBeInTheDocument();
        }
        fireEvent.click(screen.getByTitle('connections.connect'));
        expect(handlers.onConnect).toHaveBeenCalledTimes(1);
        expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    it('hides only the actions that are individually denied', () => {
        renderButtons({...STANDALONE_CONNECTION_CAPABILITIES, canDelete: false});

        expect(screen.getByTitle('connections.edit')).toBeInTheDocument();
        expect(screen.queryByTitle('connections.delete')).not.toBeInTheDocument();
    });
});
