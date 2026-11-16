import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {useEffect} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TriggerEditorModal} from '@/components/modals/TriggerEditorModal';
import type {DriverCapabilities} from '@/types/plugins';

const mocks = vi.hoisted(() => ({call: vi.fn(), editorValue: undefined as string | undefined}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => mocks}));
vi.mock('@/hooks/useDatabase', () => ({useDatabase: () => ({activeSchema: undefined})}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: vi.fn()})}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({usePlatformCapabilities: () => ({})}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('@/components/ui/SqlEditorWrapper', () => ({
    SqlEditorWrapper: ({
        initialValue,
        onChange,
        onMount,
    }: {
        initialValue: string;
        onChange: (value: string) => void;
        onMount?: (editor: {getValue: () => string}) => void;
    }) => {
        useEffect(() => {
            onMount?.({getValue: () => mocks.editorValue ?? initialValue});
        }, [initialValue, onMount]);
        return (
            <textarea
                aria-label="Trigger SQL"
                value={initialValue}
                onChange={(event) => onChange(event.target.value)}
            />
        );
    },
}));

const sql =
    'CREATE OR ALTER TRIGGER T ACTIVE BEFORE INSERT POSITION 7 AS BEGIN NEW.N=1; NEW.M=2; END';
const capabilities = {triggers: true, sql_dialect: 'generic'} as DriverCapabilities;
const props = {
    isOpen: true,
    onClose: vi.fn(),
    connectionId: 'native',
    triggerName: 'T',
    tableName: 'DATA',
    database: 'test.fdb',
    capabilities,
};

describe('plugin trigger SQL editor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.editorValue = undefined;
    });

    it('saves the current editor buffer before its debounced change reaches React', async () => {
        mocks.call.mockImplementation(async (command) =>
            command === 'get_trigger_definition' ? sql : undefined,
        );
        render(<TriggerEditorModal {...props} />);
        await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(sql));
        mocks.editorValue = sql.replace('NEW.N=1', 'NEW.N=99');
        fireEvent.click(screen.getByRole('button', {name: 'triggers.save'}));
        await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
        expect(mocks.call).toHaveBeenLastCalledWith(
            'create_trigger',
            expect.objectContaining({triggerSql: mocks.editorValue}),
        );
    });

    it('saves the complete native PSQL statement without splitting or dropping the trigger', async () => {
        mocks.call.mockImplementation(async (command) =>
            command === 'get_trigger_definition' ? sql : undefined,
        );
        render(<TriggerEditorModal {...props} />);
        await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(sql));
        fireEvent.click(screen.getByRole('button', {name: 'triggers.save'}));
        await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
        expect(mocks.call.mock.calls.map((call) => call[0])).toEqual([
            'get_trigger_definition',
            'create_trigger',
        ]);
        expect(mocks.call).toHaveBeenLastCalledWith('create_trigger', {
            connectionId: 'native',
            database: 'test.fdb',
            triggerSql: sql,
        });
    });

    it('keeps the existing trigger and editor open when saving fails', async () => {
        mocks.call.mockImplementation(async (command) => {
            if (command === 'get_trigger_definition') return sql;
            throw new Error('invalid trigger body');
        });
        render(<TriggerEditorModal {...props} />);
        await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(sql));
        fireEvent.click(screen.getByRole('button', {name: 'triggers.save'}));
        await screen.findByRole('alert');
        expect(props.onClose).not.toHaveBeenCalled();
        expect(mocks.call.mock.calls.map((call) => call[0])).toEqual([
            'get_trigger_definition',
            'create_trigger',
        ]);
    });

    it('creates a native trigger from the entered SQL', async () => {
        mocks.call.mockResolvedValue(undefined);
        render(<TriggerEditorModal {...props} isNewTrigger />);
        fireEvent.change(screen.getByRole('textbox'), {
            target: {value: sql.replace('OR ALTER ', '')},
        });
        fireEvent.click(screen.getByRole('button', {name: 'triggers.create'}));
        await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
        expect(mocks.call).toHaveBeenCalledOnce();
    });

    it('seeds a new trigger statement with the selected table name', async () => {
        mocks.call.mockResolvedValue(undefined);
        render(<TriggerEditorModal {...props} isNewTrigger />);
        expect(screen.getByRole('textbox')).toHaveValue('CREATE TRIGGER name\nON "DATA"\n');
    });
});
