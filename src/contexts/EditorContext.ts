import { createContext } from 'react';
import type { Tab, TableSchema, QueryResultEntry } from '../types/editor';

export interface EditorContextType {
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  addTab: (tab?: Partial<Tab>) => string;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToLeft: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  updateTab: (id: string, partial: Partial<Tab>) => void;
  /**
   * Functional update of a single result entry inside a tab's `results` array,
   * matched by entry id. Used to resolve batch result tabs progressively as
   * each statement completes — safe under rapid back-to-back events because it
   * reads the latest state instead of a possibly-stale snapshot.
   */
  updateResultEntry: (
    tabId: string,
    entryId: string,
    partial: Partial<QueryResultEntry>,
  ) => void;
  setActiveTabId: (id: string) => void;
  getSchema: (connectionId: string, schemaVersion?: number, schema?: string) => Promise<TableSchema[]>;
}

export const EditorContext = createContext<EditorContextType | undefined>(undefined);
