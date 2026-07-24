import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRightSidebar } from "../../hooks/useRightSidebar";
import { useRightSidebarResize } from "../../hooks/useRightSidebarResize";
import { RowEditorPanel } from "../ui/RowEditorPanel";

export const RightSidebar = () => {
	const { t } = useTranslation();
	const { isOpen, activePanel, rowEditorData, isPinned, close, togglePin, onChangeRef } =
		useRightSidebar();
	const { width, startResize } = useRightSidebarResize();

	// Stable onChange that delegates to the ref (always calls the latest handler)
	const handleChange = useCallback(
		(colName: string, value: unknown) => {
			onChangeRef.current?.(colName, value);
		},
		[onChangeRef],
	);

	if (!isOpen || !activePanel) return null;

	return (
		<aside
			className="bg-elevated border-l border-strong flex flex-col relative shrink-0 animate-slide-in-right overflow-hidden"
			style={{ width: `${width}px` }}
		>
			{/* Left-edge resize handle */}
			<button
				type="button"
				onMouseDown={startResize}
				aria-label={t("rightSidebar.resize", {
					defaultValue: "Resize sidebar",
				})}
				title={t("rightSidebar.resize", { defaultValue: "Resize sidebar" })}
				className="absolute top-0 bottom-0 -left-1 w-2 cursor-col-resize group/resize z-10"
			>
				<span
					aria-hidden
					className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-default group-hover/resize:bg-blue-500 group-hover/resize:w-0.5 transition-all"
				/>
			</button>

			{/* Panel content */}
			{activePanel === "row-editor" && rowEditorData && (
				<RowEditorPanel
					rowData={rowEditorData.rowData}
					originalRowData={rowEditorData.originalRowData}
					rowIndex={rowEditorData.rowIndex}
					isInsertion={rowEditorData.isInsertion}
					columns={rowEditorData.columns}
					autoIncrementColumns={rowEditorData.autoIncrementColumns}
					defaultValueColumns={rowEditorData.defaultValueColumns}
					nullableColumns={rowEditorData.nullableColumns}
					onChange={handleChange}
					focusField={rowEditorData.focusField}
					focusTrigger={rowEditorData.focusTrigger}
					detectJsonInTextColumns={rowEditorData.detectJsonInTextColumns}
					connectionId={rowEditorData.connectionId}
					tableName={rowEditorData.tableName}
					pkColumns={rowEditorData.pkColumns}
					schema={rowEditorData.schema}
					onClose={close}
					isPinned={isPinned}
					onTogglePin={togglePin}
				/>
			)}
		</aside>
	);
};
