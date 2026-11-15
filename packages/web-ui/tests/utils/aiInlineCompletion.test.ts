import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type * as Monaco from 'monaco-editor';
import type {TypedCommandCaller} from '@/api/contract';
import {
    inlineContext,
    inlineSchema,
    inlineTables,
    installAiInlineCompletion,
} from '@/utils/aiInlineCompletion';

function fixture(text = 'SELECT ') {
    const events = new Map<string, () => void>();
    const dispose = vi.fn();
    let version = 1;
    let currentText = text;
    let currentPosition = position(text.length + 1);
    const model = {
        getOffsetAt: (at: Monaco.IPosition) => at.column - 1,
        getPositionAt: (offset: number) => position(Math.min(currentText.length, offset) + 1),
        getValueInRange: (range: Monaco.IRange) =>
            currentText.slice(range.startColumn - 1, range.endColumn - 1),
        getVersionId: () => version,
        getLineMaxColumn: () => currentText.length + 1,
        isDisposed: () => false,
    } as unknown as Monaco.editor.ITextModel;
    const event = (name: string) => (listener: () => void) => {
        events.set(name, listener);
        return {dispose};
    };
    const editor = {
        getModel: () => model,
        getPosition: () => currentPosition,
        hasTextFocus: () => true,
        getSelections: () => [{}],
        getSelection: () => ({isEmpty: () => true}),
        getOption: () => false,
        trigger: vi.fn(),
        executeEdits: vi.fn(),
        onDidChangeModelContent: event('content'),
        onDidChangeCursorSelection: event('cursor'),
        onDidChangeModel: event('model'),
        onDidBlurEditorText: event('blur'),
        onDidCompositionStart: event('compositionStart'),
        onDidCompositionEnd: event('compositionEnd'),
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    let provider!: Monaco.languages.InlineCompletionsProvider;
    const monaco = {
        editor: {EditorOption: {readOnly: 1}},
        Range: class {
            constructor(
                public startLineNumber: number,
                public startColumn: number,
                public endLineNumber: number,
                public endColumn: number,
            ) {}
        },
        languages: {
            registerInlineCompletionsProvider: vi.fn((_language, next) => {
                provider = next;
                return {dispose};
            }),
        },
    } as unknown as typeof Monaco;
    const call = vi.fn().mockResolvedValue(' FROM users');
    const client = {call} as unknown as TypedCommandCaller;
    const install = (provider = 'ollama', key = 'connection:db:public') =>
        installAiInlineCompletion(editor, monaco, client, {
            provider,
            model: 'local',
            key,
            schema: 'users',
            dialect: 'postgres',
        });
    const registration = install();
    let cancel!: () => void;
    const token = {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn((callback) => {
            cancel = callback;
            return {dispose};
        }),
    } as unknown as Monaco.CancellationToken;
    const provide = (selectedSuggestionInfo?: Monaco.languages.SelectedSuggestionInfo) =>
        provider.provideInlineCompletions(
            model,
            currentPosition,
            {selectedSuggestionInfo} as Monaco.languages.InlineCompletionContext,
            token,
        );
    return {
        model,
        editor,
        monaco,
        call,
        provide,
        events,
        dispose,
        registration,
        install,
        cancel: () => cancel(),
        edit(next: string) {
            currentText = next;
            version++;
            currentPosition = position(next.length + 1);
            events.get('content')?.();
        },
        move(column: number) {
            currentPosition = position(column);
            events.get('cursor')?.();
        },
    };
}

function position(column: number): Monaco.Position {
    return {
        lineNumber: 1,
        column,
        equals: (other: Monaco.IPosition) => other.lineNumber === 1 && other.column === column,
    } as Monaco.Position;
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('AI inline completion', () => {
    it('debounces and returns only an insertion, with no command that could execute SQL', async () => {
        const f = fixture();
        const result = f.provide();
        await vi.advanceTimersByTimeAsync(599);
        expect(f.call).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(await result).toEqual({
            items: [
                {
                    insertText: ' FROM users',
                    range: {startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 8},
                },
            ],
            suppressSuggestions: false,
        });
        expect(f.call).toHaveBeenCalledWith('complete_ai_inline', {
            req: {
                requestId: expect.any(String),
                provider: 'ollama',
                model: 'local',
                prefix: 'SELECT ',
                suffix: '',
                schema: 'users',
                dialect: 'postgres',
            },
        });
        expect(f.editor.executeEdits).not.toHaveBeenCalled();
        expect(f.editor.trigger).not.toHaveBeenCalled();
        f.registration.dispose();
    });

    it('cancels a pending debounce before any provider request', async () => {
        const f = fixture();
        const result = f.provide();
        f.cancel();
        await vi.advanceTimersByTimeAsync(700);
        expect(await result).toEqual({items: []});
        expect(f.call).not.toHaveBeenCalled();
        f.registration.dispose();
    });

    it.each(['content', 'cursor', 'model', 'blur', 'compositionStart'])(
        'cancels in-flight requests on %s and discards the late response',
        async (event) => {
            const f = fixture();
            let respond!: (value: string) => void;
            f.call.mockImplementation((command) =>
                command === 'complete_ai_inline'
                    ? new Promise<string>((resolve) => {
                          respond = resolve;
                      })
                    : Promise.resolve(),
            );
            const result = f.provide();
            await vi.advanceTimersByTimeAsync(600);
            f.events.get(event)?.();
            expect(await result).toEqual({items: []});
            expect(f.call).toHaveBeenCalledWith('cancel_ai_inline', {
                requestId: expect.any(String),
            });
            respond('late SQL');
            await Promise.resolve();
            expect(f.editor.executeEdits).not.toHaveBeenCalled();
            f.registration.dispose();
        },
    );

    it('keeps completion widgets, selection, read-only editors and IME input in control', async () => {
        const f = fixture();
        expect(
            await f.provide({text: 'SELECT'} as Monaco.languages.SelectedSuggestionInfo),
        ).toEqual({items: []});
        f.events.get('compositionStart')?.();
        expect(await f.provide()).toEqual({items: []});
        f.events.get('compositionEnd')?.();
        vi.spyOn(f.editor, 'getSelection').mockReturnValue({
            isEmpty: () => false,
        } as Monaco.Selection);
        expect(await f.provide()).toEqual({items: []});
        expect(f.call).not.toHaveBeenCalled();
        f.registration.dispose();
    });

    it('handles provider failure quietly and backs off', async () => {
        const f = fixture();
        f.call.mockRejectedValue(new Error('provider unavailable'));
        const result = f.provide();
        await vi.advanceTimersByTimeAsync(600);
        expect(await result).toEqual({items: []});
        expect(await f.provide()).toEqual({items: []});
        expect(f.call).toHaveBeenCalledTimes(1);
        f.registration.dispose();
    });

    it('discards a response if the model version changed without a cancellation callback', async () => {
        const f = fixture();
        let respond!: (value: string) => void;
        f.call.mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    respond = resolve;
                }),
        );
        const result = f.provide();
        await vi.advanceTimersByTimeAsync(600);
        vi.spyOn(f.model, 'getVersionId').mockReturnValue(2);
        respond('stale');
        expect(await result).toEqual({items: []});
        f.registration.dispose();
    });

    it('suppresses read-only editors, multiple cursors and unfocused editors', async () => {
        const f = fixture();
        const readOnly = vi.spyOn(f.editor, 'getOption').mockReturnValue(true);
        expect(await f.provide()).toEqual({items: []});
        readOnly.mockRestore();
        const selections = vi
            .spyOn(f.editor, 'getSelections')
            .mockReturnValue([{} as Monaco.Selection, {} as Monaco.Selection]);
        expect(await f.provide()).toEqual({items: []});
        selections.mockRestore();
        vi.spyOn(f.editor, 'hasTextFocus').mockReturnValue(false);
        expect(await f.provide()).toEqual({items: []});
        expect(f.call).not.toHaveBeenCalled();
        f.registration.dispose();
    });

    it('allows single-line insertions in the middle of a line and refuses invalid multiline ranges', async () => {
        const f = fixture();
        f.move(4);
        const result = f.provide();
        await vi.advanceTimersByTimeAsync(600);
        expect((await result)?.items[0]?.range?.startColumn).toBe(4);
        f.call.mockResolvedValue('line one\nline two');
        const multiline = f.provide();
        await vi.advanceTimersByTimeAsync(600);
        expect(await multiline).toEqual({items: []});
        f.registration.dispose();
    });

    it('invalidates a request on disposal before registering a new model/provider/context', async () => {
        const f = fixture();
        f.call.mockImplementation((command) =>
            command === 'complete_ai_inline' ? new Promise(() => {}) : Promise.resolve(),
        );
        const result = f.provide();
        await vi.advanceTimersByTimeAsync(600);
        f.registration.dispose();
        expect(await result).toEqual({items: []});
        expect(f.call).toHaveBeenCalledWith('cancel_ai_inline', expect.anything());
        const next = f.install('custom-openai', 'other-db');
        expect(f.monaco.languages.registerInlineCompletionsProvider).toHaveBeenCalledTimes(2);
        next.dispose();
    });

    it('bounds surrounding text and allowlists schema fields', () => {
        const f = fixture('x'.repeat(6000));
        const bounded = inlineContext(f.model, position(4501));
        expect(bounded.prefix).toHaveLength(4000);
        expect(bounded.suffix).toHaveLength(1000);
        expect(inlineSchema([{name: 'users', schema: 'public', comment: 'secret comment'}])).toBe(
            '{"name":"users","schema":"public"}',
        );
        expect(inlineSchema([{name: 'x'.repeat(9000)}])).toHaveLength(8000);
        f.registration.dispose();
    });
});

describe('cached schema context', () => {
    const state = {
        tables: [{name: 'active_table'}],
        activeSchema: 'public',
        activeDatabaseName: 'db',
        activeCapabilities: {schemas: true, sql_dialect: 'postgres'},
        schemaDataMap: {},
        databaseDataMap: {},
        nestedDatabaseDataMap: {},
    } as unknown as Parameters<typeof inlineTables>[0];
    it('supports external driver capabilities without looking at driver ids', () => {
        expect(inlineTables(state, 'public', 'db')).toEqual(state.tables);
        expect(inlineTables(state, 'private', 'db')).toEqual([]);
        expect(inlineTables(state, 'public', 'other-db')).toEqual([]);
    });
    it('uses only the selected nested database/schema or the exact flat database', () => {
        const tables = [{name: 'nested_table'}];
        const nested = {
            ...state,
            nestedDatabaseDataMap: {other: {schemaDataMap: {private: {tables}}}},
        } as unknown as typeof state;
        expect(inlineTables(nested, 'private', 'other')).toEqual(tables);
        expect(inlineTables(nested, 'public', 'other')).toEqual([]);
        const flat = {
            ...state,
            activeCapabilities: {schemas: false},
            databaseDataMap: {other: {tables}},
        } as unknown as typeof state;
        expect(inlineTables(flat, undefined, 'other')).toEqual(tables);
    });
});
