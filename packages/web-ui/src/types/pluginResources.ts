export interface PluginResourceListProps {
    items: ReadonlyArray<{id: string; title: string; subtitle?: string; status?: string}>;
    onOpen: (id: string) => void;
    emptyMessage: string;
    label?: string;
}

export interface PluginCodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    language?: 'javascript' | 'typescript' | 'json' | 'plaintext';
    /** A display filename; the host isolates the underlying model per editor. */
    fileName?: string;
    onDiagnostics?: (
        diagnostics: ReadonlyArray<{
            severity: 'error' | 'warning' | 'info';
            message: string;
            line: number;
            column: number;
        }>,
    ) => void;
    readOnly?: boolean;
    label?: string;
}
