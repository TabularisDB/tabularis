import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {X, Loader2, Copy, Check, FileCode, List, Table2, PenLine, Trash2, Play} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useDatabase } from "../../hooks/useDatabase";
import { Modal } from "../ui/Modal";
import { SqlPreview } from "../ui/SqlPreview";
import { useAlert } from "../../hooks/useAlert";
import {
  generateCreateTableSQL,
  type TableColumn,
  type ForeignKey,
  type Index,
} from "../../utils/sqlGenerator";
import { toBindParamName } from "../../utils/queryParameters";

interface GenerateSQLModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
}

export const GenerateSQLModal = ({
  isOpen,
  onClose,
  tableName,
}: GenerateSQLModalProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeConnectionId, activeDriver, activeSchema, activeCapabilities } =
    useDatabase();
  const { showAlert } = useAlert();
  type SqlTab = "create" | "select-all" | "select-fields" | "update" | "delete";
  const [tab, setTab] = useState<SqlTab>("create");
  const [sql, setSql] = useState<string>("");
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !activeConnectionId || !tableName) return;

    const generateSQL = async () => {
      setLoading(true);
      try {
        const schemaParam = activeSchema ? { schema: activeSchema } : {};
        const [fetchedColumns, foreignKeys, indexes] = await Promise.all([
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
          invoke<Index[]>("get_indexes", {
            connectionId: activeConnectionId,
            tableName,
            ...schemaParam,
          }),
        ]);

        setColumns(fetchedColumns);
        const generatedSQL = generateCreateTableSQL(
          tableName,
          fetchedColumns,
          foreignKeys,
          indexes,
          activeCapabilities ?? "sqlite",
        );
        setSql(generatedSQL);
      } catch (err) {
        console.error(err);
        showAlert(String(err), { title: t("common.error"), kind: "error" });
      } finally {
        setLoading(false);
      }
    };

    void generateSQL();
  }, [
    isOpen,
    activeConnectionId,
    tableName,
    activeDriver,
    activeCapabilities,
    t,
    activeSchema,
    showAlert,
  ]);

  const getTabSql = (currentTab: SqlTab): string => {
    switch (currentTab) {
      case "create":
        return sql;
      case "select-all":
        return `SELECT *\nFROM ${tableName};`;
      case "select-fields": {
        if (columns.length === 0)
          return `SELECT *\nFROM ${tableName}\nLIMIT 100;`;
        const fields = columns.map((c) => `  ${c.name}`).join(",\n");
        return `SELECT\n${fields}\nFROM ${tableName}\nLIMIT 100;`;
      }
      case "update": {
        if (columns.length === 0)
          return `UPDATE ${tableName}\nSET column = :column\nWHERE 1 = 0;`;
        const setClauses = columns
          .map((c) => `  ${c.name} = :${toBindParamName(c.name)}`)
          .join(",\n");
        return `UPDATE ${tableName}\nSET\n${setClauses}\nWHERE 1 = 0;`;
      }
      case "delete":
        return `DELETE\nFROM ${tableName}\nWHERE 1 = 0;`;
    }
  };

  const displayedSql = getTabSql(tab);

  const handleRunInConsole = () => {
    navigate("/editor", {
      state: {
        initialQuery: displayedSql,
        queryName: `${tableName} – ${tab}`,
        undefined,
        preventAutoRun: true,
        schema: activeSchema ?? undefined
      },
    });
    onClose();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayedSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[900px] max-w-[90vw] h-[80vh] max-h-[800px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <FileCode size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("generateSQL.title", { table: tableName })}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-default px-6 overflow-x-auto">
          {(
            [
              {
                id: "create" as SqlTab,
                icon: FileCode,
                labelKey: "generateSQL.tabCreateTable",
              },
              {
                id: "select-all" as SqlTab,
                icon: List,
                labelKey: "generateSQL.tabSelectAll",
              },
              {
                id: "select-fields" as SqlTab,
                icon: Table2,
                labelKey: "generateSQL.tabSelectFields",
              },
              {
                id: "update" as SqlTab,
                icon: PenLine,
                labelKey: "generateSQL.tabUpdate",
              },
              {
                id: "delete" as SqlTab,
                icon: Trash2,
                labelKey: "generateSQL.tabDelete",
              },
            ] as const
          ).map(({ id: tabId, icon: Icon, labelKey }) => (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              className={clsx(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                tab === tabId
                  ? "text-primary border-blue-500"
                  : "text-muted border-transparent hover:text-primary",
              )}
            >
              <Icon size={14} />
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-hidden flex flex-col">
          {loading ? (
            <div className="text-center py-8 text-muted">
              <Loader2 size={24} className="animate-spin mx-auto mb-2" />
              <span>{t("generateSQL.loading")}</span>
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex-1 overflow-hidden rounded-lg border border-default">
                <SqlPreview
                  sql={displayedSql}
                  height="100%"
                  showLineNumbers={true}
                  className="h-full"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
            <button
              onClick={handleRunInConsole}
              className="px-4 py-2 bg-surface-secondary hover:bg-surface-tertiary text-secondary hover:text-primary border border-default rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Play size={16} />
              {t("generateSQL.runInConsole")}
            </button>
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? t("generateSQL.copied") : t("generateSQL.copy")}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};
