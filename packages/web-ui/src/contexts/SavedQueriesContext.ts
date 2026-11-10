import {createContext} from 'react';

export interface SavedQuery {
    id: string;
    name: string;
    sql: string;
    connection_id: string;
    database: string | null;
    created_at: string | null;
    updated_at: string | null;
    /** Null or absent means Unfiled. */
    folder_id?: string | null;
}

export interface SavedQueryFolder {
    id: string;
    connection_id: string;
    name: string;
    created_at: string | null;
}

/** A previous content of a saved query, kept when a save changed its SQL. */
export interface SavedQueryVersion {
    id: string;
    name: string;
    sql: string;
    database: string | null;
    /** When this content was saved. */
    saved_at: string | null;
}

export interface SavedQueriesContextType {
    queries: SavedQuery[];
    folders: SavedQueryFolder[];
    isLoading: boolean;
    saveQuery: (name: string, sql: string, database?: string | null) => Promise<void>;
    updateQuery: (id: string, name: string, sql: string, database?: string | null) => Promise<void>;
    deleteQuery: (id: string) => Promise<void>;
    /** Previous versions of a saved query, newest first. */
    getQueryVersions: (id: string) => Promise<SavedQueryVersion[]>;
    /** Makes a version the current content; the replaced content becomes a version. */
    restoreQueryVersion: (id: string, versionId: string) => Promise<void>;
    createFolder: (name: string) => Promise<void>;
    renameFolder: (id: string, name: string) => Promise<void>;
    /** Only empty folders can be deleted; rejects otherwise. */
    deleteFolder: (id: string) => Promise<void>;
    /** A null folderId moves the query back to Unfiled. */
    moveQuery: (id: string, folderId: string | null) => Promise<void>;
    refreshQueries: () => Promise<void>;
}

export const SavedQueriesContext = createContext<SavedQueriesContextType | undefined>(undefined);
