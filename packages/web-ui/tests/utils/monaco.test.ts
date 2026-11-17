import {describe, expect, it, vi} from 'vitest';
import {loader} from '@monaco-editor/react';
import {ensureMonaco} from '@/utils/monaco';

const {jsDefaults, tsDefaults} = vi.hoisted(() => ({
    jsDefaults: {setCompilerOptions: vi.fn(), setDiagnosticsOptions: vi.fn(), addExtraLib: vi.fn()},
    tsDefaults: {setCompilerOptions: vi.fn(), setDiagnosticsOptions: vi.fn(), addExtraLib: vi.fn()},
}));
vi.mock('monaco-editor', () => ({
    editor: {colorize: vi.fn()},
    languages: {},
    typescript: {
        javascriptDefaults: jsDefaults,
        typescriptDefaults: tsDefaults,
        ScriptTarget: {ESNext: 99},
        ModuleKind: {ESNext: 99},
        ModuleResolutionKind: {NodeJs: 2},
    },
}));
vi.mock('@monaco-editor/react', () => ({loader: {config: vi.fn()}}));
vi.mock('@/utils/monacoInputArea', () => ({installMonacoInputAreaSelectionFix: vi.fn()}));
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({
    default: class EditorWorker {},
}));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({
    default: class JsonWorker {},
}));

vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({
    default: class TypeScriptWorker {},
}));

describe('ensureMonaco', () => {
    it('configures the bundled offline editor and workers once, before releasing concurrent callers', async () => {
        expect(loader.config).not.toHaveBeenCalled();
        const first = ensureMonaco();
        const second = ensureMonaco();
        expect(second).toBe(first);
        const monaco = await first;
        expect(loader.config).toHaveBeenCalledExactlyOnceWith({monaco});
        expect(self.MonacoEnvironment?.getWorker).toBeTypeOf('function');
        expect(jsDefaults.setCompilerOptions).toHaveBeenCalledWith(
            expect.objectContaining({checkJs: true, noEmit: true}),
        );
        expect(tsDefaults.addExtraLib).toHaveBeenCalledWith(
            expect.any(String),
            'file:///node_modules/@types/node/crypto.d.ts',
        );
        expect(tsDefaults.addExtraLib).toHaveBeenCalledWith(
            expect.any(String),
            'file:///node_modules/undici-types/index.d.ts',
        );
        expect(self.MonacoEnvironment?.getWorker?.('', 'typescript')?.constructor.name).toBe(
            'TypeScriptWorker',
        );
        expect(self.MonacoEnvironment?.getWorker?.('', 'javascript')?.constructor.name).toBe(
            'TypeScriptWorker',
        );
        await ensureMonaco();
        expect(jsDefaults.setCompilerOptions).toHaveBeenCalledTimes(1);
        expect(loader.config).toHaveBeenCalledTimes(1);
    });
});
