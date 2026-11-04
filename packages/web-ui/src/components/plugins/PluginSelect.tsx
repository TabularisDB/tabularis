import {StyledSelect} from '@/components/ui/StyledSelect';
import type {PluginSelectProps} from '@/types/pluginSelect';

/** Provider forms share the host's themed native selection and keyboard behavior. */
export function PluginSelect({options, ...props}: PluginSelectProps) {
    const labels = new Map(options.map((option) => [option.value, option.label]));
    return (
        <StyledSelect
            {...props}
            variant="form"
            className="w-full min-w-0"
            options={options.map((option) => option.value)}
            getOptionLabel={(value) => labels.get(value) ?? value}
        />
    );
}
