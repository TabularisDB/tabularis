import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
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
	}, []);

	const toggle = useCallback(() => {
		setIsOpen((prev) => !prev);
	}, []);

	const togglePin = useCallback(() => {
		setIsPinned((prev) => !prev);
	}, []);

	// Listen for keyboard shortcut custom event
	useEffect(() => {
		const handler = () => {
			setIsOpen((prev) => !prev);
		};
		window.addEventListener("tabularis:toggle-right-sidebar", handler);
		return () => {
			window.removeEventListener("tabularis:toggle-right-sidebar", handler);
		};
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
