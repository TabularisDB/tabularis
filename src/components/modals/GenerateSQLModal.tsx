import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, Copy, Check, FileCode } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
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
  const { activeConnectionId, activeDriver, activeSchema, activeCapabilities } = useDatabase();
  const { showAlert } = useAlert();
  const [sql, setSql] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !activeConnectionId || !tableName) return;

    const generateSQL = async () => {
      setLoading(true);
      try {
        const schemaParam = activeSchema ? { schema: activeSchema } : {};
        const [columns, foreignKeys, indexes] = await Promise.all([
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

        const generatedSQL = generateCreateTableSQL(
          tableName,
          columns,
          foreignKeys,
          indexes,
          activeCapabilities ?? 'sqlite',
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
  }, [isOpen, activeConnectionId, tableName, activeDriver, activeCapabilities, t, activeSchema]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
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
                  sql={sql}
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
