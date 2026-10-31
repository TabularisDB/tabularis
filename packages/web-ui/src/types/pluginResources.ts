export interface PluginResourceListProps {
    items: ReadonlyArray<{id: string; title: string; subtitle?: string; status?: string}>;
    onOpen: (id: string) => void;
    emptyMessage: string;
    label?: string;
}

export interface PluginCodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    language?: 'javascript' | 'json' | 'plaintext';
    readOnly?: boolean;
    label?: string;
}
