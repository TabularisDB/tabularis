export interface PluginSelectProps {
    id?: string;
    ariaLabel?: string;
    ariaDescribedBy?: string;
    value: string;
    options: ReadonlyArray<{value: string; label: string; description?: string}>;
    onChange: (value: string) => void;
    disabled?: boolean;
    placeholder?: string;
    loading?: boolean;
    loadingLabel?: string;
}
