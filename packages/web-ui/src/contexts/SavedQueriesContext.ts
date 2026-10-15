import { createContext } from 'react';

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  connection_id: string;
  database: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SavedQueriesContextType {
  queries: SavedQuery[];
  isLoading: boolean;
  saveQuery: (name: string, sql: string, database?: string | null) => Promise<void>;
  updateQuery: (id: string, name: string, sql: string, database?: string | null) => Promise<void>;
  deleteQuery: (id: string) => Promise<void>;
  refreshQueries: () => Promise<void>;
}

export const SavedQueriesContext = createContext<SavedQueriesContextType | undefined>(undefined);
