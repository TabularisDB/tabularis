/** Console routes use saved IDs so browser history cannot select another project. */
export function consoleUrl(binding: {projectId: unknown; branchId?: unknown}): string | undefined {
    const validId = (value: unknown): value is string =>
        typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
    if (!validId(binding.projectId)) return undefined;
    const project = `https://console.neon.tech/app/projects/${encodeURIComponent(binding.projectId)}`;
    if (binding.branchId === undefined || binding.branchId === null || binding.branchId === '')
        return project;
    if (!validId(binding.branchId)) return undefined;
    return `${project}/branches/${encodeURIComponent(binding.branchId)}`;
}
