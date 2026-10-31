export interface BranchContext {
    projectId: string | null;
    branchId: string | null;
    branchName: string | null;
    database: string | null;
    role: string | null;
}
export interface BranchItem {
    id: string;
    name: string;
    parentId: string | null;
    state: string;
    isDefault: boolean;
    protected: boolean;
}
export interface BranchSnapshot {
    projectName: string;
    branches: BranchItem[];
    bindings: {id: string; name: string; context: BranchContext}[];
    unresolvedConnections?: number;
}
