import {describe, expect, it, vi} from 'vitest';
import {render} from '@testing-library/react';
import {PluginCodeEditor} from '@/components/plugins/PluginCodeEditor';

const {editor} = vi.hoisted(() => ({editor: vi.fn()}));
vi.mock('@/components/ui/LazyMonaco', () => ({
    MonacoEditor: (props: unknown) => {
        editor(props);
        return <div />;
    },
}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: {editorFontSize: 17, editorFontFamily: 'JetBrains Mono'}}),
}));
vi.mock('@/hooks/useEditorTheme', () => ({useEditorTheme: () => ({id: 'test-theme'})}));
vi.mock('@/themes/themeUtils', () => ({loadMonacoTheme: vi.fn()}));

describe('PluginCodeEditor', () => {
    it('uses host Monaco and editor preferences without SQL execution actions', () => {
        const onChange = vi.fn();
        render(
            <PluginCodeEditor
                value="export default {}"
                language="javascript"
                label="Function source"
                onChange={onChange}
                readOnly
            />,
        );
        const props = editor.mock.lastCall?.[0];
        expect(props).toMatchObject({
            value: 'export default {}',
            language: 'javascript',
            options: {
                readOnly: true,
                domReadOnly: true,
                fontSize: 17,
                ariaLabel: 'Function source',
            },
        });
        expect(props).not.toHaveProperty('onRun');
        props.onChange('export default {fetch(){}}');
        expect(onChange).toHaveBeenCalledWith('export default {fetch(){}}');
    });
});

it('provides isolated file models and forwards portable diagnostics', () => {
    const onDiagnostics = vi.fn();
    render(
        <PluginCodeEditor
            value="const value: number = 'bad'"
            language="typescript"
            fileName="index.ts"
            onChange={vi.fn()}
            onDiagnostics={onDiagnostics}
        />,
    );
    const props = editor.mock.lastCall?.[0];
    expect(props.path).toMatch(/\/index\.ts$/);
    expect(props.options.renderValidationDecorations).toBe('on');
    props.onValidate([
        {
            severity: 8,
            message: 'Type mismatch',
            startLineNumber: 1,
            startColumn: 7,
            endLineNumber: 1,
            endColumn: 12,
            resource: 'private-model',
        },
    ]);
    expect(onDiagnostics).toHaveBeenCalledWith([
        {severity: 'error', message: 'Type mismatch', line: 1, column: 7},
    ]);
});
