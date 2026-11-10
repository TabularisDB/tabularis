export interface LinkedFolder {
    id: string;
    name: string;
    /** Canonical absolute path of the linked root. */
    path: string;
}

export interface LinkedFolderStatus extends LinkedFolder {
    /** False when the root was moved, deleted or became unreadable. */
    available: boolean;
}

export type LinkedEntryKind = 'directory' | 'file';

export interface LinkedEntry {
    name: string;
    /** Path below the root, always `/`-separated. */
    relativePath: string;
    kind: LinkedEntryKind;
}

export interface LinkedDirectoryListing {
    entries: LinkedEntry[];
    /** The directory held more entries than the backend lists. */
    truncated: boolean;
}

export interface LinkedFileContent {
    /** Canonical absolute path: the stable identity of the file. */
    path: string;
    content: string;
    version: string;
}

export interface LinkedFileSaved {
    path: string;
    version: string;
}

/** Where a tab's file lives inside a linked folder, and the disk version it was last in sync with. */
export interface LinkedFileRef {
    folderId: string;
    relativePath: string;
    version: string;
}
