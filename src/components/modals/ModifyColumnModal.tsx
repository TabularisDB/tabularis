import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Save, Loader2, AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { SqlPreview } from "../ui/SqlPreview";
import { useDatabase } from "../../hooks/useDatabase";
import { useDataTypes } from "../../hooks/useDataTypes";
import { useDrivers } from "../../hooks/useDrivers";
import { Modal } from "../ui/Modal";
import { supportsAlterColumn } from "../../utils/driverCapabilities";
import { parseColumnType, buildColumnDefinition } from "../../utils/columnTypes";
import type { ColumnFormData } from "../../utils/columnTypes";

type ColumnDef = ColumnFormData;

interface ModifyColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  connectionId: string;
  tableName: string;
  driver: string;
  // If provided, we are in "Edit" mode. If null, "Add" mode.
  column?: {
    name: string;
    data_type: string;
    is_nullable: boolean;
    is_pk: boolean;
    is_auto_increment: boolean;
  } | null;
}

export const ModifyColumnModal = ({
  isOpen,
  onClose,
  onSuccess,
  connectionId,
  tableName,
  driver,
  column,
}: ModifyColumnModalProps) => {
  const { t } = useTranslation();
  const { activeSchema } = useDatabase();
  const { dataTypes } = useDataTypes(driver);
  const { allDrivers } = useDrivers();
  const driverManifest = allDrivers.find((d) => d.id === driver);
  const driverCapabilities = driverManifest?.capabilities ?? null;
  const canAlterPk = driverCapabilities?.alter_primary_key !== false;
  const canAlterColumn = supportsAlterColumn(driverCapabilities);
  const isEdit = !!column;

  const availableTypes = useMemo(
    () => dataTypes?.types || [],
    [dataTypes],
  );

  const parseType = (fullType: string) => parseColumnType(fullType, availableTypes);

  const initial = useMemo(() => {
    if (column) {
      const { type, length } = parseType(column.data_type);
      return {
        name: column.name,
        type,
        length,
        isNullable: column.is_nullable,
        defaultValue: "",
        isPk: column.is_pk || false,
        isAutoInc: column.is_auto_increment || false,
      };
    }
    return {
      name: "",
      type: "VARCHAR",
      length: "255",
      isNullable: true,
      defaultValue: "",
      isPk: false,
      isAutoInc: false,
    };
  }, [column, availableTypes]);

  const [form, setForm] = useState<ColumnDef>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sqlPreview, setSqlPreview] = useState("-- ...");

  // Reset form when modal opens/changes
  useEffect(() => {
    setForm(initial);
    setError("");
    setSqlPreview("-- ...");
  }, [initial, isOpen]);

  // Generate SQL preview via backend
  const generatePreview = useCallback(async () => {
    if (!form.name) {
      setSqlPreview("-- " + t("modifyColumn.nameRequired"));
      return;
    }

    try {
      let stmts: string[];
      if (isEdit) {
        const oldCol = buildColumnDefinition({
          name: column!.name,
          type: parseType(column!.data_type).type,
          length: parseType(column!.data_type).length,
          isNullable: column!.is_nullable,
          defaultValue: "",
          isPk: column!.is_pk,
          isAutoInc: column!.is_auto_increment,
        });
        const newCol = buildColumnDefinition(form);
        stmts = await invoke<string[]>("get_alter_column_sql", {
          connectionId,
          table: tableName,
          oldColumn: oldCol,
          newColumn: newCol,
          ...(activeSchema ? { schema: activeSchema } : {}),
        });
      } else {
        const col = buildColumnDefinition(form);
        stmts = await invoke<string[]>("get_add_column_sql", {
          connectionId,
          table: tableName,
          column: col,
          ...(activeSchema ? { schema: activeSchema } : {}),
        });
      }
      setSqlPreview(stmts.map((s) => s + ";").join("\n"));
    } catch (e) {
      setSqlPreview("-- " + String(e));
    }
  }, [form, isEdit, column, connectionId, tableName, activeSchema, t]);

  // Debounced preview generation
  useEffect(() => {
    const timer = setTimeout(generatePreview, 300);
    return () => clearTimeout(timer);
  }, [generatePreview]);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError(t("modifyColumn.nameRequired"));
      return;
    }
    setLoading(true);
    setError("");

    try {
      let stmts: string[];
      if (isEdit) {
        const oldCol = buildColumnDefinition({
          name: column!.name,
          type: parseType(column!.data_type).type,
          length: parseType(column!.data_type).length,
          isNullable: column!.is_nullable,
          defaultValue: "",
          isPk: column!.is_pk,
          isAutoInc: column!.is_auto_increment,
        });
        const newCol = buildColumnDefinition(form);
        stmts = await invoke<string[]>("get_alter_column_sql", {
          connectionId,
          table: tableName,
          oldColumn: oldCol,
          newColumn: newCol,
          ...(activeSchema ? { schema: activeSchema } : {}),
        });
      } else {
        const col = buildColumnDefinition(form);
        stmts = await invoke<string[]>("get_add_column_sql", {
          connectionId,
          table: tableName,
          column: col,
          ...(activeSchema ? { schema: activeSchema } : {}),
        });
      }

      for (const sql of stmts) {
        await invoke("execute_query", {
          connectionId,
          query: sql,
          ...(activeSchema ? { schema: activeSchema } : {}),
        });
      }

      onSuccess();
      onClose();
    } catch (e) {
      console.error(e);
      setError(t("modifyColumn.fail") + String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
      <div className="bg-elevated rounded-xl shadow-2xl w-[500px] border border-strong flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-surface-secondary/50 rounded-t-xl">
          <h2 className="text-lg font-semibold text-primary">
            {isEdit ? t("modifyColumn.titleEdit") : t("modifyColumn.titleAdd")}
          </h2>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-4">
          {!canAlterColumn && isEdit && (
            <div className="bg-warning-bg border border-warning-border text-warning-text text-xs p-3 rounded flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{t("modifyColumn.sqliteWarn")}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-secondary mb-1">
              {t("modifyColumn.name")}
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-base border border-strong rounded p-2 text-primary text-sm focus:border-focus outline-none font-mono"
              placeholder="column_name"
              autoFocus
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-secondary mb-1">
                {t("modifyColumn.type")}
              </label>
              <select
                value={form.type}
                onChange={(e) => {
                  const newType = e.target.value;
                  const typeInfo = availableTypes.find((t) => t.name === newType);
                  const needsLength = typeInfo?.requires_length || typeInfo?.requires_precision;
                  setForm({
                    ...form,
                    type: newType,
                    length: needsLength
                      ? form.length || typeInfo?.default_length || ""
                      : "",
                  });
                }}
                disabled={!canAlterColumn && isEdit}
                className="w-full bg-base border border-strong rounded p-2 text-primary text-sm focus:border-focus outline-none disabled:opacity-50 appearance-none cursor-pointer hover:bg-elevated transition-colors"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                  backgroundPosition: `right 0.5rem center`,
                  backgroundRepeat: `no-repeat`,
                  backgroundSize: `1.5em 1.5em`,
                  paddingRight: `2.5rem`,
                }}
              >
                {availableTypes.map((typeInfo) => (
                  <option key={typeInfo.name} value={typeInfo.name}>
                    {typeInfo.name}
                  </option>
                ))}
              </select>
              {availableTypes.find((t) => t.name === form.type)?.requires_extension && (
                <div className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  <span>{t("modifyColumn.requiresExtension", { ext: availableTypes.find((t) => t.name === form.type)?.requires_extension })}</span>
                </div>
              )}
            </div>
            <div className="w-24">
              <label className="block text-xs font-semibold text-secondary mb-1">
                {t("modifyColumn.length")}
              </label>
              <input
                value={form.length}
                onChange={(e) => setForm({ ...form, length: e.target.value })}
                disabled={
                  (!canAlterColumn && isEdit) ||
                  !availableTypes.find((t) => t.name === form.type)?.requires_length &&
                  !availableTypes.find((t) => t.name === form.type)?.requires_precision
                }
                className="w-full bg-base border border-strong rounded p-2 text-primary text-sm focus:border-focus outline-none font-mono disabled:opacity-50"
                placeholder={
                  availableTypes.find((t) => t.name === form.type)?.default_length || ""
                }
              />
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-secondary mb-1">
                {t("modifyColumn.default")}
              </label>
              <input
                value={form.defaultValue}
                onChange={(e) =>
                  setForm({ ...form, defaultValue: e.target.value })
                }
                disabled={!canAlterColumn && isEdit}
                className="w-full bg-base border border-strong rounded p-2 text-primary text-sm focus:border-focus outline-none font-mono disabled:opacity-50"
                placeholder="NULL"
              />
            </div>
          </div>

          <div className="flex gap-6 mt-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isNullable"
                checked={!form.isNullable}
                onChange={(e) =>
                  setForm({ ...form, isNullable: !e.target.checked })
                }
                disabled={!canAlterColumn && isEdit}
                className="accent-blue-500"
              />
              <label
                htmlFor="isNullable"
                className="text-sm text-secondary select-none cursor-pointer"
              >
                {t("modifyColumn.notNull")}
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isPk"
                checked={form.isPk}
                onChange={(e) => setForm({ ...form, isPk: e.target.checked })}
                disabled={isEdit || !canAlterPk}
                className="accent-blue-500 disabled:opacity-50"
              />
              <label
                htmlFor="isPk"
                className={`text-sm select-none cursor-pointer ${isEdit || !canAlterPk ? "text-muted" : "text-secondary"}`}
                title={!canAlterPk ? t("modifyColumn.pkNotSupported") : undefined}
              >
                {t("modifyColumn.primaryKey")}
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isAutoInc"
                checked={form.isAutoInc}
                onChange={(e) =>
                  setForm({ ...form, isAutoInc: e.target.checked })
                }
                disabled={
                  (isEdit && !(canAlterColumn && !!driverCapabilities?.auto_increment_keyword)) ||
                  !availableTypes.find((t) => t.name === form.type)?.supports_auto_increment
                }
                className="accent-blue-500 disabled:opacity-50"
              />
              <label
                htmlFor="isAutoInc"
                className={`text-sm select-none cursor-pointer ${(isEdit && !(canAlterColumn && !!driverCapabilities?.auto_increment_keyword)) || !availableTypes.find((t) => t.name === form.type)?.supports_auto_increment ? "text-muted" : "text-secondary"}`}
              >
                {t("modifyColumn.autoInc")}
              </label>
            </div>
          </div>

          {/* Preview */}
          <div className="mt-2">
            <div className="text-[10px] text-muted mb-1 uppercase tracking-wider">
              {t("modifyColumn.sqlPreview")}
            </div>
            <SqlPreview
              sql={sqlPreview}
              height="100px"
              showLineNumbers={true}
            />
          </div>

          {error && (
            <div className="text-error-text text-xs bg-error-bg border border-error-border p-2 rounded">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-surface-secondary/50 border-t border-default rounded-b-xl flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary hover:bg-surface-secondary font-medium text-sm rounded-lg transition-colors"
          >
            {t("modifyColumn.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={
              loading ||
              (!canAlterColumn && isEdit && form.name === column?.name)
            }
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-primary px-6 py-2 rounded-lg font-medium text-sm flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            <Save size={16} />{" "}
            {isEdit ? t("modifyColumn.save") : t("modifyColumn.add")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
