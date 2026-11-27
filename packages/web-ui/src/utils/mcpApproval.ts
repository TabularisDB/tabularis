import type {McpApprovalMode} from '@/types/ai';

export const MCP_APPROVAL_LABELS = {
    all: 'mcp.safety.modeAll',
    writes_only: 'mcp.safety.modeWritesOnly',
    off: 'mcp.safety.modeOff',
} as const satisfies Record<McpApprovalMode, string>;

export function parseMcpApprovalMode(value: unknown): McpApprovalMode | null {
    return value === 'all' || value === 'writes_only' || value === 'off' ? value : null;
}
