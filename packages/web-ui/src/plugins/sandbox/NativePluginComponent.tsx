import {PluginCodeEditor} from '@/components/plugins/PluginCodeEditor';
import {PluginDataGrid} from '@/components/plugins/PluginDataGrid';
import type {PluginNativeComponent as NativeComponent} from '@/types/pluginNative';
import type {PluginCodeEditorProps} from '@/types/pluginResources';
import type {PluginDataGridProps} from '@/types/pluginDataGrid';
import {useLayoutEffect, useRef, useState} from 'react';

interface Props {
    component: NativeComponent;
    emit: (id: string, event: string, value: unknown) => void;
    hidden?: boolean;
}

function NativePluginCodeEditor({component, emit}: Props) {
    const props = component.props as unknown as PluginCodeEditorProps;
    const generation = component.editorState?.generation ?? 0;
    const [source, setSource] = useState({generation, value: props.value});
    if (generation > source.generation) setSource({generation, value: props.value});
    const latest = useRef({generation: source.generation, revision: 0});
    useLayoutEffect(() => {
        latest.current = {generation: source.generation, revision: 0};
    }, [source.generation]);
    return (
        <PluginCodeEditor
            key={source.generation}
            {...props}
            value={source.value}
            onChange={(value) => {
                if (source.generation !== latest.current.generation) return;
                const edit = {
                    value,
                    generation: latest.current.generation,
                    revision: ++latest.current.revision,
                };
                // Monaco owns live edits. Reapplying even a valid echo can overwrite a
                // newer model while React commits; only a new source generation resets it.
                emit(component.id, 'change', edit);
            }}
            onDiagnostics={(value) => emit(component.id, 'diagnostics', value)}
        />
    );
}

/** Native tools stay in the trusted renderer and are clipped to their owning frame. */
export function NativePluginComponent({component, emit, hidden = false}: Props) {
    const {rect, kind, props} = component;
    const {clip, ...bounds} = rect;
    return (
        <div
            style={{
                display: hidden ? 'none' : undefined,
                position: 'absolute',
                ...bounds,
                clipPath: clip
                    ? `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px)`
                    : undefined,
                overflow: 'hidden',
                pointerEvents: 'auto',
            }}
        >
            {kind === 'codeEditor' ? (
                <NativePluginCodeEditor component={component} emit={emit} />
            ) : (
                <PluginDataGrid {...(props as unknown as PluginDataGridProps)} />
            )}
        </div>
    );
}
