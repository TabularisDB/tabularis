import { createContext, type MutableRefObject } from "react";

export type RightSidebarPanel = "row-editor" | null;

export interface RowEditorPanelData {
	rowData: Record<string, unknown>;
	originalRowData?: Record<string, unknown>;
	rowIndex: number;
	focusField?: string;
	/** Incremented to re-trigger focus even when focusField value is the same */
	focusTrigger?: number;
	isInsertion: boolean;
	columns: Array<{
		name: string;
		type?: string;
		characterMaximumLength?: number;
	}>;
	autoIncrementColumns?: string[];
	defaultValueColumns?: string[];
	nullableColumns?: string[];
	detectJsonInTextColumns?: boolean;
	connectionId?: string | null;
	tableName?: string | null;
	pkColumns?: string[] | null;
	schema?: string | null;
}

export interface RightSidebarContextValue {
	isOpen: boolean;
	activePanel: RightSidebarPanel;
	rowEditorData: RowEditorPanelData | null;
	isPinned: boolean;
	// Stable action refs — identity never changes
	openRowEditor: (data: RowEditorPanelData) => void;
	updateRowEditorData: (data: Partial<RowEditorPanelData>) => void;
	close: () => void;
	toggle: () => void;
	setActivePanel: (panel: RightSidebarPanel) => void;
	togglePin: () => void;
	// Ref for the onChange handler — set by DataGrid, called by RowEditorPanel
	onChangeRef: MutableRefObject<((colName: string, value: unknown) => void) | null>;
}

export const RightSidebarContext = createContext<
	RightSidebarContextValue | undefined
>(undefined);
