import { Pin, PinOff, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRowEditor } from "../../hooks/useRowEditor";
import { FieldEditor } from "./FieldEditor";
import { SlotAnchor } from "./SlotAnchor";

interface RowEditorPanelProps {
	onClose: () => void;
	rowData: Record<string, unknown>;
	originalRowData?: Record<string, unknown>;
	rowIndex: number;
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
	focusField?: string;
	/** Incremented to re-trigger focus even when focusField value is the same */
	focusTrigger?: number;
	detectJsonInTextColumns?: boolean;
	connectionId?: string | null;
	tableName?: string | null;
	pkColumns?: string[] | null;
	schema?: string | null;
	isPinned?: boolean;
	onTogglePin?: () => void;
}

export const RowEditorPanel = ({
	onClose,
	rowData,
	originalRowData,
	rowIndex,
	isInsertion,
	columns,
	autoIncrementColumns,
	defaultValueColumns,
	nullableColumns,
	onChange,
	focusField,
	focusTrigger,
	detectJsonInTextColumns = false,
	connectionId,
	tableName,
	pkColumns,
	schema,
	isPinned = false,
	onTogglePin,
}: RowEditorPanelProps) => {
	const { t } = useTranslation();
	const { editedData, updateField } = useRowEditor({
		initialData: rowData,
		onChange: (fieldName, value) => onChange(fieldName, value),
	});

	const pkMap = useMemo(
		() =>
			pkColumns && pkColumns.length > 0
				? Object.fromEntries(pkColumns.map((col) => [col, rowData[col]]))
				: undefined,
		[pkColumns, rowData],
	);

	// Refs to track field containers for scrolling
	const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});

	// Scroll to and focus the specified field when focusField/focusTrigger changes
	useEffect(() => {
		if (focusField && fieldRefs.current[focusField]) {
			// Wait for any animation to complete
			setTimeout(() => {
				const fieldElement = fieldRefs.current[focusField];
				if (fieldElement) {
					// Scroll the field into view
					fieldElement.scrollIntoView({ behavior: "smooth", block: "center" });

					// Focus the input inside the field
					const input = fieldElement.querySelector(
						"input, textarea",
					) as HTMLElement;
					if (input) {
						input.focus();
					}
				}
			}, 150);
		}
	}, [focusField, focusTrigger]);

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b border-default bg-base">
				<div>
					<h2 className="text-lg font-semibold text-primary">
						{t("rowEditor.title")}
					</h2>
					<p className="text-xs text-secondary mt-0.5">
						{t("rowEditor.subtitle", { row: rowIndex + 1 })}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<SlotAnchor
						name="row-editor-sidebar.header.actions"
						context={{
							connectionId,
							tableName,
							schema,
							rowData,
							rowIndex,
							isInsertion,
						}}
						className="flex items-center gap-1"
					/>
					{onTogglePin && (
						<button
							type="button"
							onClick={onTogglePin}
							className={`transition-colors ${isPinned ? "text-accent" : "text-secondary hover:text-primary"}`}
							title={t(isPinned ? "rowEditor.unpin" : "rowEditor.pin", {
								defaultValue: isPinned ? "Unpin from row" : "Pin to row",
							})}
						>
							{isPinned ? <Pin size={16} /> : <PinOff size={16} />}
						</button>
					)}
					<button
						type="button"
						onClick={onClose}
						className="text-secondary hover:text-primary transition-colors"
					>
						<X size={20} />
					</button>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-6 space-y-6">
				{columns.map((column) => {
					const value = editedData[column.name];

					return (
						<div
							key={column.name}
							className="space-y-2"
							ref={(el) => {
								fieldRefs.current[column.name] = el;
							}}
						>
							<label className="block text-xs font-bold text-muted">
								{column.name}
								{column.type && (
									<span className="ml-2 normal-case font-normal">
										({column.type})
									</span>
								)}
							</label>

							<FieldEditor
								name={column.name}
								type={column.type}
								characterMaximumLength={column.characterMaximumLength}
								value={value}
								originalValue={originalRowData?.[column.name]}
								detectJsonInTextColumns={detectJsonInTextColumns}
								onChange={(newValue) => updateField(column.name, newValue)}
								placeholder={t("rowEditor.enterValue")}
								isInsertion={isInsertion}
								isAutoIncrement={autoIncrementColumns?.includes(column.name)}
								hasDefault={defaultValueColumns?.includes(column.name)}
								isNullable={nullableColumns?.includes(column.name)}
								connectionId={connectionId}
								tableName={tableName}
								pkMap={pkMap}
								schema={schema}
							/>
							<SlotAnchor
								name="row-editor-sidebar.field.after"
								context={{
									connectionId,
									tableName,
									schema,
									columnName: column.name,
									rowData: editedData,
									rowIndex,
									isInsertion,
									onFieldChange: (value: unknown) =>
										updateField(column.name, value),
								}}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
};
