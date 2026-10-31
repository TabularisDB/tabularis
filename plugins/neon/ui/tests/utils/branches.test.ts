import {describe, expect, it} from 'vitest';
import {branchDeletionBlocked, matchingBranchConnection} from '../../src/utils/branches';
import type {BranchContext, BranchItem, BranchSnapshot} from '../../src/types/branches';
const context: BranchContext = {
    projectId: 'p',
    branchId: 'b',
    branchName: 'dev',
    database: 'db',
    role: 'owner',
};
const branch: BranchItem = {
    id: 'b',
    name: 'dev',
    parentId: 'parent',
    state: 'ready',
    isDefault: false,
    protected: false,
};
const snapshot: BranchSnapshot = {projectName: 'Project', branches: [branch], bindings: []};
describe('branch identity', () => {
    it('reuses only the exact project, branch, database and role', () => {
        const bindings = [{id: 'saved', name: 'Alias', context}];
        expect(matchingBranchConnection(bindings, context)).toBe('saved');
        for (const patch of [
            {projectId: 'other'},
            {branchId: 'other'},
            {database: 'other'},
            {role: 'other'},
            {role: null},
        ])
            expect(matchingBranchConnection(bindings, {...context, ...patch})).toBeUndefined();
    });
    it('prevents deletion of bound, current, default, protected and parent branches', () => {
        expect(branchDeletionBlocked(branch, 'other', snapshot, 'p')).toBe(false);
        expect(
            branchDeletionBlocked(branch, 'other', {...snapshot, unresolvedConnections: 1}, 'p'),
        ).toBe(true);
        expect(branchDeletionBlocked(branch, 'b', snapshot, 'p')).toBe(true);
        expect(branchDeletionBlocked({...branch, isDefault: true}, 'other', snapshot, 'p')).toBe(
            true,
        );
        expect(branchDeletionBlocked({...branch, protected: true}, 'other', snapshot, 'p')).toBe(
            true,
        );
        expect(
            branchDeletionBlocked(
                branch,
                'other',
                {...snapshot, bindings: [{id: 'saved', name: 'Alias', context}]},
                'p',
            ),
        ).toBe(true);
        expect(
            branchDeletionBlocked(
                branch,
                'other',
                {...snapshot, branches: [branch, {...branch, id: 'child', parentId: 'b'}]},
                'p',
            ),
        ).toBe(true);
    });
});
