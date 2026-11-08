import type {Branch, NeonClient} from '@neon/sdk';
import type {Params} from './database.js';
import {ManagementError} from './management.js';

export const branchMethods = new Set([
    'account_branch_list',
    'account_branch_create',
    'account_branch_rename',
    'account_branch_delete',
]);
const branchId = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(value))
        throw new ManagementError('Invalid branch ID');
    return value;
};
function branchName(value: unknown): string {
    if (
        typeof value !== 'string' ||
        !value.trim() ||
        value !== value.trim() ||
        Buffer.byteLength(value) > 255 ||
        [...value].some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
    )
        throw new ManagementError(
            'Branch names must contain 1–255 bytes without surrounding whitespace or control characters',
        );
    return value;
}
function metadata(branch: Branch) {
    return {
        id: branch.id,
        name: branch.name,
        parentId: branch.parent_id ?? null,
        state: branch.current_state,
        isDefault: branch.default,
        protected: branch.protected,
    };
}

export async function manageBranches(
    client: NeonClient<true>,
    method: string,
    args: Params,
    scope: {projectId: string; branchId: string},
): Promise<unknown> {
    if (method === 'account_branch_list') {
        const [project, branches] = await Promise.all([
            client.projects.get({projectId: scope.projectId}),
            client.branches.list({projectId: scope.projectId}).all(),
        ]);
        return {projectName: project.name, branches: branches.map(metadata)};
    }
    if (method === 'account_branch_create') {
        const name = branchName(args.name);
        const parent = branchId(args.parentId);
        await client.branches.get({projectId: scope.projectId, branchId: parent});
        return metadata(
            await client.branches.create({projectId: scope.projectId, name, parent_id: parent}),
        );
    }
    const target = branchId(args.targetBranchId);
    if (method === 'account_branch_rename') {
        const name = branchName(args.name);
        return metadata(
            await client.branches.update({projectId: scope.projectId, branchId: target, name}),
        );
    }
    if (method === 'account_branch_delete') {
        if (target === scope.branchId)
            throw new ManagementError('Cannot delete the connection’s current branch');
        const current = await client.branches.get({projectId: scope.projectId, branchId: target});
        if (current.default || current.protected)
            throw new ManagementError('Cannot delete a default or protected branch');
        if (args.confirmName !== current.name)
            throw new ManagementError('Type the current branch name exactly to confirm deletion');
        const branches = await client.branches.list({projectId: scope.projectId}).all();
        if (branches.some((branch) => branch.parent_id === target))
            throw new ManagementError('Delete child branches first');
        await client.branches.delete({projectId: scope.projectId, branchId: target});
        return null;
    }
    throw new ManagementError('Unsupported branch operation');
}
