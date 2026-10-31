import type {BranchContext, BranchItem, BranchSnapshot} from '../types/branches';
export function matchingBranchConnection(
    bindings: BranchSnapshot['bindings'],
    target: BranchContext,
): string | undefined {
    if (!target.projectId || !target.branchId || !target.database || !target.role) return undefined;
    return bindings.find(
        ({context}) =>
            context.projectId === target.projectId &&
            context.branchId === target.branchId &&
            context.database === target.database &&
            context.role === target.role,
    )?.id;
}
export function branchDeletionBlocked(
    branch: BranchItem,
    currentBranchId: string,
    snapshot: BranchSnapshot,
    projectId: string,
): boolean {
    return (
        (snapshot.unresolvedConnections ?? 0) > 0 ||
        branch.id === currentBranchId ||
        branch.isDefault ||
        branch.protected ||
        snapshot.branches.some((item) => item.parentId === branch.id) ||
        snapshot.bindings.some(
            ({context}) => context.projectId === projectId && context.branchId === branch.id,
        )
    );
}
