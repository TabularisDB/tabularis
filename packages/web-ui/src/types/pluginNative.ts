export interface PluginNativeRect {
    left: number;
    top: number;
    width: number;
    height: number;
    clip?: {top: number; right: number; bottom: number; left: number};
}

export interface PluginNativeComponent {
    id: string;
    kind: 'codeEditor' | 'dataGrid';
    rect: PluginNativeRect;
    props: Record<string, unknown>;
    modal?: boolean;
    /** Source generation and acknowledged host edit; internal to the native editor bridge. */
    editorState?: {generation: number; revision: number};
}
