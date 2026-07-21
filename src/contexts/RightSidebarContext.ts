import { createContext } from "react";

export type RightSidebarPanel = "row-editor" | null;

export interface RowEditorPanelData {
	rowData: Record<string, unknown>;
	originalRowData?: Record<string, unknown>;
	rowIndex: number;
	focusField?: string;
	isInsertion: boolean;
	columns: Array<{
		name: string;
		type?: string;
		characterMaximumLength?: number;
	}>;
	autoIncrementColumns?: string[];
	defaultValueColumns?: string[];
	nullableColumns?: string[];
	onChange: (colName: string, value: unknown) => void;
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
	openRowEditor: (data: RowEditorPanelData) => void;
	updateRowEditorData: (data: Partial<RowEditorPanelData>) => void;
	close: () => void;
	toggle: () => void;
	setActivePanel: (panel: RightSidebarPanel) => void;
	togglePin: () => void;
}

export const RightSidebarContext = createContext<
	RightSidebarContextValue | undefined
>(undefined);
