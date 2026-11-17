import {describe, expect, it} from 'vitest';
import {parsePluginNativeComponent, parsePluginNativeRect} from '@/utils/pluginNative';

describe('sandbox native component protocol', () => {
    const rect = {left: 10, top: -15, width: 400, height: 250};
    it('accepts bounded editor data and readonly grid data scoped by the host', () => {
        expect(
            parsePluginNativeComponent(
                {
                    id: 'editor',
                    kind: 'codeEditor',
                    rect,
                    props: {value: 'export default 1', language: 'typescript'},
                },
                'own',
            ).kind,
        ).toBe('codeEditor');
        const grid = parsePluginNativeComponent(
            {id: 'grid', kind: 'dataGrid', rect, props: {columns: ['id'], rows: [[1]]}},
            'own',
        );
        expect(grid.props.connectionId).toBe('own');
    });
    it('rejects arbitrary host components, callbacks, connection spoofing and malformed data', () => {
        expect(() =>
            parsePluginNativeComponent(
                {id: 'x', kind: 'NewConnectionModal', rect, props: {}},
                'own',
            ),
        ).toThrow('Unsupported');
        expect(() =>
            parsePluginNativeComponent(
                {id: 'x', kind: 'codeEditor', rect, props: {value: '', onChange: 'invoke'}},
                'own',
            ),
        ).toThrow('Unsupported');
        expect(() =>
            parsePluginNativeComponent(
                {
                    id: 'x',
                    kind: 'dataGrid',
                    rect,
                    props: {columns: ['id'], rows: [[1]], connectionId: 'foreign'},
                },
                'own',
            ),
        ).toThrow('another connection');
        expect(() =>
            parsePluginNativeComponent(
                {id: 'x', kind: 'dataGrid', rect, props: {columns: ['id'], rows: [[1, 2]]}},
                'own',
            ),
        ).toThrow('rows');
        expect(() =>
            parsePluginNativeComponent(
                {id: 'x', kind: 'codeEditor', rect, props: {value: 'x'.repeat(1_048_577)}},
                'own',
            ),
        ).toThrow('too large');
    });
    it('rejects nonfinite, negative size and unbounded native rectangles', () => {
        expect(() => parsePluginNativeRect({...rect, width: Number.NaN})).toThrow('bounds');
        expect(() => parsePluginNativeRect({...rect, height: -1})).toThrow('size');
        expect(() => parsePluginNativeRect({...rect, left: 1_000_000})).toThrow('bounds');
    });
    it('accepts editor acknowledgements and rejects invalid revision metadata', () => {
        const component = {
            id: 'editor',
            kind: 'codeEditor',
            rect,
            props: {value: 'source'},
            editorState: {generation: 2, revision: 10},
        };
        expect(parsePluginNativeComponent(component, 'own').editorState).toEqual({
            generation: 2,
            revision: 10,
        });
        expect(() =>
            parsePluginNativeComponent(
                {...component, editorState: {generation: 0, revision: -1}},
                'own',
            ),
        ).toThrow('revision');
        expect(() =>
            parsePluginNativeComponent(
                {...component, editorState: {generation: 1, revision: Number.NaN}},
                'own',
            ),
        ).toThrow('revision');
    });
});
