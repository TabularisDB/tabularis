/** Connection-scoped calls to a trusted plugin process. Secrets are write-only from UI code. */
export interface UsePluginRpcReturn {
    call: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
    saveSecrets: (secrets: Record<string, string>) => Promise<void>;
    secretFields: () => Promise<string[]>;
    deleteSecrets: () => Promise<void>;
}
