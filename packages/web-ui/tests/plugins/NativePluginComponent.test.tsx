import {act, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {NativePluginComponent} from '@/plugins/sandbox/NativePluginComponent';
import type {PluginNativeComponent as NativeComponent} from '@/types/pluginNative';
import {useLayoutEffect, useState} from 'react';

const editor = vi.hoisted(() => ({change: (_value: string) => {}, values: [] as string[]}));
vi.mock('@/components/plugins/PluginCodeEditor', () => ({
    PluginCodeEditor: ({value, onChange}: {value: string; onChange: (value: string) => void}) => {
        const [model, setModel] = useState(value);
        useLayoutEffect(() => {
            setModel(value);
            editor.values.push(value);
        }, [value]);
        editor.change = (text) => {
            setModel(text);
            onChange(text);
        };
        return <textarea aria-label="Projected source" value={model} readOnly />;
    },
}));
vi.mock('@/components/plugins/PluginDataGrid', () => ({PluginDataGrid: () => null}));

describe('projected native editor revisions', () => {
    it('retains burst typing across reordered acknowledgements and accepts deliberate replacements', () => {
        const emit = vi.fn();
        editor.values = [];
        const component = (value: string, generation = 0, revision = 0): NativeComponent => ({
            id: 'source',
            kind: 'codeEditor',
            rect: {left: 0, top: 0, width: 400, height: 300},
            props: {value},
            editorState: {generation, revision},
        });
        const view = (value: string, generation = 0, revision = 0) => (
            <NativePluginComponent component={component(value, generation, revision)} emit={emit} />
        );
        const {rerender} = render(view(''));
        const source = 'const revision = 2;';
        act(() => {
            for (let length = 1; length <= source.length; length++)
                editor.change(source.slice(0, length));
        });
        expect(screen.getByRole('textbox')).toHaveValue(source);
        expect(emit).toHaveBeenLastCalledWith('source', 'change', {
            value: source,
            generation: 0,
            revision: source.length,
        });
        rerender(view('c', 0, 1));
        expect(screen.getByRole('textbox')).toHaveValue(source);
        rerender(view('const', 0, 5));
        expect(screen.getByRole('textbox')).toHaveValue(source);
        rerender(view(source, 0, source.length));
        expect(editor.values).toEqual(['']);
        rerender(view('c', 1, 0));
        expect(screen.getByRole('textbox')).toHaveValue('c');
        rerender(view(source, 0, source.length));
        expect(screen.getByRole('textbox')).toHaveValue('c');
        act(() => editor.change('changed deliberately'));
        expect(screen.getByRole('textbox')).toHaveValue('changed deliberately');
        expect(emit).toHaveBeenLastCalledWith('source', 'change', {
            value: 'changed deliberately',
            generation: 1,
            revision: 1,
        });
        rerender(view('', 2, 0));
        expect(screen.getByRole('textbox')).toHaveValue('');
        act(() => editor.change('local buffer'));
        rerender(view('', 3, 0));
        expect(screen.getByRole('textbox')).toHaveValue('');
        expect(editor.values).toEqual(['', 'c', '', '']);
    });
});
