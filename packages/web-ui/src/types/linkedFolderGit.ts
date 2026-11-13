export interface LinkedGitFile {
    path: string;
    status: string;
}
export interface LinkedGitStatus {
    repository: string;
    files: LinkedGitFile[];
}
export interface LinkedGitReview {
    path: string;
    diff: string;
    token: string;
}
export interface LinkedGitReviewedFile {
    path: string;
    token: string;
}
export interface LinkedGitCommit {
    commit: string;
    warning: string | null;
}
