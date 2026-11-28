import {useId} from 'react';
import {useTranslation} from 'react-i18next';
import type {McpApprovalMode} from '@/types/ai';
import {MCP_APPROVAL_LABELS, parseMcpApprovalMode} from '@/utils/mcpApproval';

interface McpApprovalSelectProps {
    value: McpApprovalMode | null | undefined;
    globalMode: McpApprovalMode | undefined;
    readOnly: boolean;
    onChange: (mode: McpApprovalMode | null) => void;
}

export function McpApprovalSelect({value, globalMode, readOnly, onChange}: McpApprovalSelectProps) {
    const {t} = useTranslation();
    const id = useId();
    const hintId = useId();
    const inheritedMode = parseMcpApprovalMode(globalMode) ?? 'writes_only';

    return (
        <div className="space-y-1.5">
            <label htmlFor={id} className="block text-xs font-medium text-secondary">
                {t('newConnection.mcpApprovalMode')}
            </label>
            <select
                id={id}
                value={value ?? ''}
                onChange={(event) => onChange(parseMcpApprovalMode(event.target.value))}
                aria-describedby={readOnly ? hintId : undefined}
                className="w-full rounded-lg border border-strong bg-base px-3 py-2 text-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
                <option value="">
                    {t('newConnection.mcpApprovalInherit', {
                        mode: t(MCP_APPROVAL_LABELS[inheritedMode]),
                    })}
                </option>
                {Object.entries(MCP_APPROVAL_LABELS).map(([mode, label]) => (
                    <option key={mode} value={mode}>
                        {t(label)}
                    </option>
                ))}
            </select>
            {readOnly && (
                <p id={hintId} className="text-xs text-muted">
                    {t('newConnection.mcpApprovalReadOnly')}
                </p>
            )}
        </div>
    );
}
