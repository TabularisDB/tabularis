import {
	type ReactNode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	RightSidebarContext,
	type RightSidebarPanel,
	type RowEditorPanelData,
} from "./RightSidebarContext";

export const RightSidebarProvider = ({ children }: { children: ReactNode }) => {
	const [isOpen, setIsOpen] = useState(false);
	const [activePanel, setActivePanel] = useState<RightSidebarPanel>(null);
	const [rowEditorData, setRowEditorData] = useState<RowEditorPanelData | null>(
		null,
	);
	const [isPinned, setIsPinned] = useState(false);

	// Ref for the onChange handler — set by DataGrid, called by RowEditorPanel.
	// This avoids storing closures in state (which go stale).
	const onChangeRef = useRef<((colName: string, value: unknown) => void) | null>(
		null,
	);

	const openRowEditor = useCallback((data: RowEditorPanelData) => {
		setRowEditorData(data);
		setActivePanel("row-editor");
		setIsOpen(true);
	}, []);

	const updateRowEditorData = useCallback(
		(data: Partial<RowEditorPanelData>) => {
			setRowEditorData((prev) => {
				if (!prev) return null;
				return { ...prev, ...data };
			});
		},
		[],
	);

	const close = useCallback(() => {
		setIsOpen(false);
		setActivePanel(null);
		setRowEditorData(null);
		onChangeRef.current = null;
	}, []);

	const toggle = useCallback(() => {
		setIsOpen((prev) => !prev);
	}, []);

	const togglePin = useCallback(() => {
		setIsPinned((prev) => !prev);
	}, []);

	const value = useMemo(
		() => ({
			isOpen,
			activePanel,
			rowEditorData,
			isPinned,
			openRowEditor,
			updateRowEditorData,
			close,
			toggle,
			setActivePanel,
			togglePin,
			onChangeRef,
		}),
		[
			isOpen,
			activePanel,
			rowEditorData,
			isPinned,
			openRowEditor,
			updateRowEditorData,
			close,
			toggle,
			togglePin,
		],
	);

	return (
		<RightSidebarContext.Provider value={value}>
			{children}
		</RightSidebarContext.Provider>
	);
};
