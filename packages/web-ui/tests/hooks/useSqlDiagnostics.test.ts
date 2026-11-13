import {renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type * as Monaco from 'monaco-editor';
import {
    SQL_DIAGNOSTICS_DEBOUNCE_MS,
    SQL_DIAGNOSTICS_OWNER,
    useSqlDiagnostics,
    type SqlDiagnosticsOptions,
} from '@/hooks/useSqlDiagnostics';
import type {RelationResolver} from '@/utils/sqlDiagnostics';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, params?: {name?: string}) => `${key}:${params?.name ?? ''}`,
    }),
}));

function createFakeEditor(initial: string) {
    let value = initial;
    let version = 1;
    let disposed = false;
    const listeners = new Set<() => void>();
    const setModelMarkers = vi.fn();
    const model = {
        getValue: () => value,
        getVersionId: () => version,
        isDisposed: () => disposed,
        getPositionAt: (offset: number) => {
            const before = value.slice(0, offset).split('\n');
            return {lineNumber: before.length, column: before[before.length - 1].length + 1};
        },
        onDidChangeContent: (listener: () => void) => {
            listeners.add(listener);
            return {dispose: () => listeners.delete(listener)};
        },
    };
    const monaco = {
        MarkerSeverity: {Error: 8, Warning: 4, Info: 2},
        editor: {setModelMarkers},
    };
    return {
        target: {
            editor: {getModel: () => model} as unknown as Monaco.editor.IStandaloneCodeEditor,
            monaco: monaco as unknown as typeof Monaco,
        },
        setModelMarkers,
        edit(next: string) {
            value = next;
            version++;
            listeners.forEach((listener) => listener());
        },
        dispose() {
            disposed = true;
        },
        listenerCount: () => listeners.size,
    };
}

const ordersResolver = (): RelationResolver =>
    vi.fn(async () => ({status: 'found' as const, columns: ['id', 'total']}));

const optionsFor = (
    resolveRelation: RelationResolver,
    contextKey = 'ctx',
): SqlDiagnosticsOptions => ({
    resolveRelation,
    contextKey,
});

const flush = async () => {
    await vi.advanceTimersByTimeAsync(SQL_DIAGNOSTICS_DEBOUNCE_MS);
};

describe('useSqlDiagnostics', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('publishes an error marker for an unresolved column, translated and positioned', async () => {
        const fake = createFakeEditor('SELECT o.custmer_id\nFROM orders o');
        renderHook(() => useSqlDiagnostics(fake.target, optionsFor(ordersResolver())));

        expect(fake.setModelMarkers).not.toHaveBeenCalled();
        await flush();

        expect(fake.setModelMarkers).toHaveBeenCalledTimes(1);
        const [, owner, markers] = fake.setModelMarkers.mock.calls[0];
        expect(owner).toBe(SQL_DIAGNOSTICS_OWNER);
        expect(markers).toEqual([
            expect.objectContaining({
                severity: 8,
                message: 'editor.diagnostics.unresolvedColumn:o.custmer_id',
                code: 'unresolvedColumn',
                startLineNumber: 1,
                startColumn: 10,
                endLineNumber: 1,
                endColumn: 20,
            }),
        ]);
    });

    it('maps warnings and limitations to their own severities', async () => {
        const fake = createFakeEditor('SELECT * FROM ghost, generate_series(1, 2)');
        const resolveRelation: RelationResolver = async () => ({status: 'missing'});
        renderHook(() => useSqlDiagnostics(fake.target, optionsFor(resolveRelation)));
        await flush();

        const markers = fake.setModelMarkers.mock.calls[0][2] as Array<{
            severity: number;
            code: string;
        }>;
        expect(markers.map((m) => [m.code, m.severity])).toEqual([
            ['unresolvedRelation', 4],
            ['unsupportedConstruct', 2],
        ]);
    });

    it('debounces edits and analyzes only the last text', async () => {
        const fake = createFakeEditor('SELECT o.id FROM orders o');
        const resolveRelation = ordersResolver();
        renderHook(() => useSqlDiagnostics(fake.target, optionsFor(resolveRelation)));

        await vi.advanceTimersByTimeAsync(SQL_DIAGNOSTICS_DEBOUNCE_MS - 100);
        fake.edit('SELECT o.i FROM orders o');
        await vi.advanceTimersByTimeAsync(SQL_DIAGNOSTICS_DEBOUNCE_MS - 100);
        fake.edit('SELECT o.idx FROM orders o');
        expect(fake.setModelMarkers).not.toHaveBeenCalled();
        await flush();

        expect(resolveRelation).toHaveBeenCalledTimes(1);
        expect(fake.setModelMarkers).toHaveBeenCalledTimes(1);
        expect(fake.setModelMarkers.mock.calls[0][2][0].message).toContain('o.idx');
    });

    it('discards a result when the text changed while it was in flight', async () => {
        const fake = createFakeEditor('SELECT o.stale FROM orders o');
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const resolveRelation: RelationResolver = async () => {
            await gate;
            return {status: 'found', columns: ['id']};
        };
        renderHook(() => useSqlDiagnostics(fake.target, optionsFor(resolveRelation)));

        await flush();
        fake.edit('SELECT o.id FROM orders o');
        release();
        await vi.advanceTimersByTimeAsync(0);

        expect(fake.setModelMarkers).not.toHaveBeenCalled();
        await flush();
        expect(fake.setModelMarkers).toHaveBeenCalledTimes(1);
        expect(fake.setModelMarkers.mock.calls[0][2]).toEqual([]);
    });

    it('clears markers and discards in-flight work when the context changes', async () => {
        const fake = createFakeEditor('SELECT o.total FROM orders o');
        const narrow: RelationResolver = async () => ({status: 'found', columns: ['id']});
        const wide: RelationResolver = async () => ({status: 'found', columns: ['id', 'total']});

        const {rerender} = renderHook(
            ({options}: {options: SqlDiagnosticsOptions}) =>
                useSqlDiagnostics(fake.target, options),
            {initialProps: {options: optionsFor(narrow, 'conn-a')}},
        );
        await flush();
        expect(fake.setModelMarkers.mock.calls.at(-1)?.[2]).toHaveLength(1);

        rerender({options: optionsFor(wide, 'conn-b')});
        expect(fake.setModelMarkers).toHaveBeenLastCalledWith(
            expect.anything(),
            SQL_DIAGNOSTICS_OWNER,
            [],
        );
        await flush();
        expect(fake.setModelMarkers.mock.calls.at(-1)?.[2]).toEqual([]);
    });

    it('keeps existing markers while a metadata refresh is re-analyzed', async () => {
        const fake = createFakeEditor('SELECT o.total FROM orders o');
        const narrow: RelationResolver = async () => ({status: 'found', columns: ['id']});
        const wide: RelationResolver = async () => ({status: 'found', columns: ['id', 'total']});

        const {rerender} = renderHook(
            ({options}: {options: SqlDiagnosticsOptions}) =>
                useSqlDiagnostics(fake.target, options),
            {initialProps: {options: optionsFor(narrow)}},
        );
        await flush();
        expect(fake.setModelMarkers).toHaveBeenCalledTimes(1);

        rerender({options: optionsFor(wide)});
        expect(fake.setModelMarkers).toHaveBeenCalledTimes(1);

        await flush();
        expect(fake.setModelMarkers).toHaveBeenCalledTimes(2);
        expect(fake.setModelMarkers.mock.calls.at(-1)?.[2]).toEqual([]);
    });

    it('does nothing without options and removes its markers when they go away', async () => {
        const fake = createFakeEditor('SELECT o.nope FROM orders o');
        const {rerender} = renderHook(
            ({options}: {options?: SqlDiagnosticsOptions}) =>
                useSqlDiagnostics(fake.target, options),
            {initialProps: {options: undefined as SqlDiagnosticsOptions | undefined}},
        );
        await flush();
        expect(fake.setModelMarkers).not.toHaveBeenCalled();
        expect(fake.listenerCount()).toBe(0);

        rerender({options: optionsFor(ordersResolver())});
        await flush();
        expect(fake.listenerCount()).toBe(1);

        rerender({options: undefined});
        expect(fake.listenerCount()).toBe(0);
        expect(fake.setModelMarkers).toHaveBeenLastCalledWith(
            expect.anything(),
            SQL_DIAGNOSTICS_OWNER,
            [],
        );
    });

    it('does not touch a disposed model on unmount', async () => {
        const fake = createFakeEditor('SELECT 1');
        const {unmount} = renderHook(() =>
            useSqlDiagnostics(fake.target, optionsFor(ordersResolver())),
        );
        fake.dispose();
        unmount();
        expect(fake.setModelMarkers).not.toHaveBeenCalled();
    });
});
