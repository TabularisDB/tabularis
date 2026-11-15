import type {PluginNativeComponent, PluginNativeRect} from '@/types/pluginNative';
import {providerRecord, providerString} from './providerSandbox';

export function parsePluginNativeRect(value: unknown): PluginNativeRect {
    const rect = providerRecord(value);
    for (const key of ['left', 'top', 'width', 'height']) {
        if (
            typeof rect[key] !== 'number' ||
            !Number.isFinite(rect[key]) ||
            Math.abs(rect[key]) > 100_000
        )
            throw new Error('Invalid native component bounds');
    }
    if ((rect.width as number) < 0 || (rect.height as number) < 0)
        throw new Error('Invalid native component size');
    let clip: PluginNativeRect['clip'];
    if (rect.clip !== undefined) {
        const input = providerRecord(rect.clip);
        for (const key of ['top', 'right', 'bottom', 'left']) {
            const limit = key === 'top' || key === 'bottom' ? rect.height : rect.width;
            if (
                typeof input[key] !== 'number' ||
                !Number.isFinite(input[key]) ||
                input[key] < 0 ||
                input[key] > (limit as number)
            )
                throw new Error('Invalid native component clip');
        }
        clip = input as PluginNativeRect['clip'];
    }
    return {
        left: rect.left as number,
        top: rect.top as number,
        width: rect.width as number,
        height: rect.height as number,
        ...(clip ? {clip} : {}),
    };
}

/** Accept data only: no arbitrary React trees, host callbacks or component names. */
export function parsePluginNativeComponent(
    value: unknown,
    connectionId: unknown,
): PluginNativeComponent {
    const input = providerRecord(value);
    const id = providerString(input.id, 'native component ID', 128);
    const props = providerRecord(input.props);
    const kind = input.kind;
    let editorState: PluginNativeComponent['editorState'];
    if (input.editorState !== undefined) {
        const state = providerRecord(input.editorState);
        if (
            kind !== 'codeEditor' ||
            !Number.isSafeInteger(state.generation) ||
            (state.generation as number) < 0 ||
            !Number.isSafeInteger(state.revision) ||
            (state.revision as number) < 0
        )
            throw new Error('Invalid native editor revision');
        editorState = {generation: state.generation as number, revision: state.revision as number};
    }
    if (input.modal !== undefined && typeof input.modal !== 'boolean')
        throw new Error('Invalid native component layer');
    const allowed =
        kind === 'codeEditor'
            ? ['value', 'language', 'fileName', 'readOnly', 'label']
            : kind === 'dataGrid'
              ? ['columns', 'rows', 'connectionId', 'label', 'fill']
              : [];
    if (!allowed.length || Object.keys(props).some((key) => !allowed.includes(key)))
        throw new Error('Unsupported native component properties');
    for (const key of ['label', 'fileName']) {
        if (props[key] !== undefined && (typeof props[key] !== 'string' || props[key].length > 256))
            throw new Error(`Invalid native component ${key}`);
    }
    if (kind === 'codeEditor') {
        if (typeof props.value !== 'string' || props.value.length > 1_000_000)
            throw new Error('Invalid editor source');
        if (
            props.language !== undefined &&
            !['javascript', 'typescript', 'json', 'plaintext'].includes(String(props.language))
        )
            throw new Error('Unsupported editor language');
        if (props.readOnly !== undefined && typeof props.readOnly !== 'boolean')
            throw new Error('Invalid editor read-only option');
    } else {
        if (
            !Array.isArray(props.columns) ||
            props.columns.length > 1000 ||
            props.columns.some((column) => typeof column !== 'string' || column.length > 1024)
        )
            throw new Error('Invalid data grid columns');
        if (
            !Array.isArray(props.rows) ||
            props.rows.length > 10_000 ||
            props.rows.some(
                (row) => !Array.isArray(row) || row.length !== (props.columns as unknown[]).length,
            )
        )
            throw new Error('Invalid data grid rows');
        if (props.connectionId != null && props.connectionId !== connectionId)
            throw new Error('Native component belongs to another connection');
        if (props.fill !== undefined && typeof props.fill !== 'boolean')
            throw new Error('Invalid data grid fill option');
        // A guest cannot choose which connection the native grid uses for masking/settings.
        props.connectionId = typeof connectionId === 'string' ? connectionId : null;
    }
    return {
        id,
        kind: kind as PluginNativeComponent['kind'],
        rect: parsePluginNativeRect(input.rect),
        props,
        modal: input.modal === true,
        ...(editorState ? {editorState} : {}),
    };
}
