import {PluginCodeEditor} from '@/components/plugins/PluginCodeEditor';
import {PluginDataGrid} from '@/components/plugins/PluginDataGrid';
import type {PluginNativeComponent as NativeComponent} from '@/types/pluginNative';
import type {PluginCodeEditorProps} from '@/types/pluginResources';
import type {PluginDataGridProps} from '@/types/pluginDataGrid';

interface Props {
    component: NativeComponent;
    emit: (id: string, event: string, value: unknown) => void;
}

/** Native tools stay in the trusted renderer and are clipped to their owning frame. */
export function NativePluginComponent({component, emit}: Props) {
    const {id, rect, kind, props} = component;
    const {clip, ...bounds} = rect;
    return (
        <div
            style={{
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
                <PluginCodeEditor
                    {...(props as unknown as PluginCodeEditorProps)}
                    onChange={(value) => emit(id, 'change', value)}
                    onDiagnostics={(value) => emit(id, 'diagnostics', value)}
                />
            ) : (
                <PluginDataGrid {...(props as unknown as PluginDataGridProps)} />
            )}
        </div>
    );
}
