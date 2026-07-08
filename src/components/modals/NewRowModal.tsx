import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../../hooks/useDatabase";
import { Modal } from "../ui/Modal";
import { quoteTableRef } from "../../utils/identifiers";
import { isGeometricType } from "../../utils/geometry";
import { GeometryInput } from "../ui/GeometryInput";
import type { ForeignKey } from "../../types/schema";
import { SlotAnchor } from "../ui/SlotAnchor";

interface TableColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_nullable: boolean;
  is_auto_increment: boolean;
}

interface NewRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  onSaveSuccess: () => void;
}

export const NewRowModal = ({
  isOpen,
  onClose,
  tableName,
  onSaveSuccess,
}: NewRowModalProps) => {
  const { t } = useTranslation();
  const { activeConnectionId, activeDriver, activeSchema } = useDatabase();
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [error, setError] = useState("");

  // FK Support
  const [foreignKeys, setForeignKeys] = useState<ForeignKey[]>([]);
  const [fkOptions, setFkOptions] = useState<
    Record<string, { value: unknown; label: string }[]>
  >({}); // map column_name -> options
  const [loadingFk, setLoadingFk] = useState<Record<string, boolean>>({});
  const [fkErrors, setFkErrors] = useState<Record<string, string>>({});

  const fetchFkOptions = useCallback(async (fk: ForeignKey) => {
    if (!activeConnectionId) return;
    setLoadingFk((prev) => ({ ...prev, [fk.column_name]: true }));
    setFkErrors((prev) => ({ ...prev, [fk.column_name]: "" }));
    try {
      const quotedTable = quoteTableRef(fk.ref_table, activeDriver, activeSchema);
      // Select * from referenced table to get context
      const query = `SELECT * FROM ${quotedTable} LIMIT 100`;

      const result = await invoke<{ columns: string[], rows: unknown[][] }>("execute_query", {
        connectionId: activeConnectionId,
        query,
        ...(activeSchema ? { schema: activeSchema } : {}),
      });

      const options = result.rows.map((rowArray) => {
        // Convert row array to object using columns
        const row: Record<string, unknown> = {};
        result.columns.forEach((col, idx) => {
            row[col] = rowArray[idx];
        });

        // Try to find value for ref_column (handle case sensitivity)
        let val = row[fk.ref_column];
        if (val === undefined) {
          const key = Object.keys(row).find(
            (k) => k.toLowerCase() === fk.ref_column.toLowerCase(),
          );
          if (key) val = row[key];
        }

        // Construct label from other columns
        const labelParts = Object.entries(row)
          .filter(
            ([k]) =>
              k !== fk.ref_column &&
              k.toLowerCase() !== fk.ref_column.toLowerCase(),
          )
          .slice(0, 2) // Take first 2 other columns
          .map(([, v]) => String(v));

        const labelText = labelParts.join(" | ");

        return {
          value: val,
          label: labelText ? `${val} - ${labelText}` : String(val),
        };
      });

      setFkOptions((prev) => ({ ...prev, [fk.column_name]: options }));
    } catch (e) {
      console.error(`Failed to fetch FK options for ${fk.column_name}:`, e);
      setFkErrors((prev) => ({ ...prev, [fk.column_name]: String(e) }));
    } finally {
      setLoadingFk((prev) => ({ ...prev, [fk.column_name]: false }));
    }
  }, [activeConnectionId, activeDriver, activeSchema]);

  useEffect(() => {
    if (isOpen && activeConnectionId && tableName) {
      setSchemaLoading(true);

      // Fetch columns and FKs in parallel
      const schemaParam = activeSchema ? { schema: activeSchema } : {};
      Promise.all([
        invoke<TableColumn[]>("get_columns", {
          connectionId: activeConnectionId,
          tableName,
          ...schemaParam,
        }),
        invoke<ForeignKey[]>("get_foreign_keys", {
          connectionId: activeConnectionId,
          tableName,
          ...schemaParam,
        }),
      ])
        .then(([cols, fks]) => {
          setColumns(cols);
          setForeignKeys(fks);

          // Initialize form data
          const initialData: Record<string, unknown> = {};
          cols.forEach((col) => {
            initialData[col.name] = "";
          });
          setFormData(initialData);

          // Fetch options for FKs
          fks.forEach((fk) => {
            fetchFkOptions(fk);
          });
        })
        .catch((err) => setError(t("newRow.failLoad") + err))
        .finally(() => setSchemaLoading(false));
    }
  }, [isOpen, activeConnectionId, tableName, fetchFkOptions, t, activeSchema]);

  const parseValue = (value: string, dataType: string) => {
    const type = dataType.toLowerCase();

    // Handle explicitly numeric types
    if (
      type.includes("int") ||
      type.includes("serial") ||
      type.includes("dec") ||
      type.includes("numeric") ||
      type.includes("float") ||
      type.includes("double") ||
      type.includes("real")
    ) {
      if (value.trim() === "") return null; // Or empty string? Let's say null if empty for number.
      const num = Number(value);
      return isNaN(num) ? value : num;
    }

    // Handle booleans
    if (type.includes("bool") || type.includes("tinyint(1)")) {
      if (value.toLowerCase() === "true" || value === "1") return true;
      if (value.toLowerCase() === "false" || value === "0") return false;
      // If it's literally "null" string or empty, maybe null?
      if (value.trim() === "") return null;
      return value;
    }

    // Default to string
    return value;
  };

  const handleSave = async () => {
    if (!activeConnectionId) return;
    setLoading(true);
    setError("");

    try {
      const dataToSend: Record<string, unknown> = {};

      for (const col of columns) {
        const rawVal = formData[col.name];

        // Skip if auto-increment and empty (let database generate)
        // But if user explicitly provides a value, include it (even "0")
        if (col.is_auto_increment && (rawVal === "" || rawVal === null || rawVal === undefined)) {
          continue;
        }

        if (rawVal === "" && col.is_nullable) {
          dataToSend[col.name] = null;
        } else if (rawVal !== "") {
          // Parse value based on type
          const parsed = parseValue(String(rawVal), col.data_type);
          dataToSend[col.name] = parsed;
        }
      }

      await invoke("insert_record", {
        connectionId: activeConnectionId,
        table: tableName,
        data: dataToSend,
        ...(activeSchema ? { schema: activeSchema } : {}),
      });

      onSaveSuccess();
      onClose();
    } catch (err) {
      console.error("Insert failed:", err);
      setError(t("newRow.failInsert") + String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (col: string, value: string) => {
    setFormData((prev) => ({ ...prev, [col]: value }));
  };

  // First plain text field, skipping auto-increment/FK/geometry inputs.
  const autoFocusColumn = columns.find(
    (c) =>
      !c.is_auto_increment &&
      !foreignKeys.some((fk) => fk.column_name === c.name) &&
      !isGeometricType(c.data_type),
  )?.name;

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-surface-secondary rounded-lg shadow-xl w-[600px] border border-strong flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-strong">
          <h2 className="text-lg font-semibold text-primary">
            {t("newRow.title")} ({tableName})
          </h2>
          <button onClick={onClose} className="text-secondary hover:text-primary">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-error-bg border border-error-border text-error-text rounded text-sm">
              {error}
            </div>
          )}

          {schemaLoading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="animate-spin text-blue-500" />
            </div>
          ) : (
            columns.map((col) => {
              return (
                <div key={col.name}>
                  <label className="block text-xs font-medium text-secondary mb-1 flex justify-between">
                    <span>
                      {col.name}{" "}
                      <span className="text-surface-tertiary">({col.data_type})</span>
                    </span>
                    {col.is_pk && (
                      <span className="text-semantic-pk text-[10px]">
                        {t("newRow.primaryKey")}
                      </span>
                    )}
                    {col.is_auto_increment && (
                      <span className="text-accent-info text-[10px]">
                        {t("newRow.auto")}
                      </span>
                    )}
                  </label>

                  {foreignKeys.find((fk) => fk.column_name === col.name) ? (
                    <div className="relative">
                      <select
                        value={String(formData[col.name] ?? "")}
                        onChange={(e) =>
                          handleInputChange(col.name, e.target.value)
                        }
                        className="w-full bg-elevated border border-strong rounded px-3 py-2 text-primary focus:outline-none focus:border-focus appearance-none cursor-pointer"
                        style={{
                          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                          backgroundPosition: `right 0.75rem center`,
                          backgroundRepeat: `no-repeat`,
                          backgroundSize: `1.5em 1.5em`,
                          paddingRight: `2.5rem`,
                        }}
                      >
                        <option value="">
                          {col.is_nullable
                            ? "NULL"
                            : loadingFk[col.name]
                              ? t("newRow.loading")
                              : t("newRow.selectValue")}
                        </option>
                        {fkOptions[col.name]?.length > 0
                          ? fkOptions[col.name]?.map((opt, i) => (
                              <option key={i} value={String(opt.value)}>
                                {opt.label}
                              </option>
                            ))
                          : !loadingFk[col.name] && (
                              <option value="" disabled>
                                {fkErrors[col.name]
                                  ? `Error: ${fkErrors[col.name]}`
                                  : t("newRow.noOptions")}
                              </option>
                            )}
                      </select>
                      {loadingFk[col.name] && (
                        <Loader2
                          size={12}
                          className="absolute right-10 top-1/2 -translate-y-1/2 animate-spin text-muted"
                        />
                      )}
                    </div>
                  ) : isGeometricType(col.data_type) ? (
                    <GeometryInput
                      value={String(formData[col.name] ?? "")}
                      dataType={col.data_type}
                      onChange={(val) => handleInputChange(col.name, val)}
                      placeholder={
                        col.is_auto_increment
                          ? t("newRow.autoGenerated")
                          : col.is_nullable
                            ? "NULL"
                            : t("newRow.required")
                      }
                      className={`
                            w-full bg-elevated border rounded px-3 py-2 text-primary focus:outline-none focus:border-focus
                            ${col.is_auto_increment ? "border-default text-secondary placeholder:text-muted" : "border-strong"}
                          `}
                    />
                  ) : (
                    <input
                      value={String(formData[col.name] ?? "")}
                      onChange={(e) =>
                        handleInputChange(col.name, e.target.value)
                      }
                      autoFocus={col.name === autoFocusColumn}
                      placeholder={
                        col.is_auto_increment
                          ? t("newRow.autoGenerated")
                          : col.is_nullable
                            ? "NULL"
                            : t("newRow.required")
                      }
                      className={`
                            w-full bg-elevated border rounded px-3 py-2 text-primary focus:outline-none focus:border-focus
                            ${col.is_auto_increment ? "border-default text-secondary placeholder:text-muted" : "border-strong"}
                          `}
                    />
                  )}
                  <SlotAnchor
                    name="row-edit-modal.field.after"
                    context={{
                      connectionId: activeConnectionId,
                      tableName,
                      schema: activeSchema,
                      driver: activeDriver,
                      columnName: col.name,
                      rowData: formData,
                      onFieldChange: (value: unknown) => setFormData((prev) => ({ ...prev, [col.name]: value })),
                    }}
                  />
                </div>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-strong bg-surface-secondary/50 flex justify-end gap-3 rounded-b-lg">
          <SlotAnchor
            name="row-edit-modal.footer.before"
            context={{
              connectionId: activeConnectionId,
              tableName,
              schema: activeSchema,
              driver: activeDriver,
              rowData: formData,
            }}
            className="flex items-center gap-2"
          />
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary hover:bg-surface-secondary font-medium text-sm rounded-lg transition-colors"
          >
            {t("newRow.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 text-primary px-6 py-2 rounded font-medium text-sm flex items-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            <Plus size={16} /> {t("newRow.insert")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
