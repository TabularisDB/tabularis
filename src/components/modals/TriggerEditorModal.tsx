import { useState, useEffect, useCallback } from "react";
import { useLingui } from "@lingui/react/macro";
import { X, Loader2, Zap, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useAlert } from "../../hooks/useAlert";
import { SqlEditorWrapper } from "../ui/SqlEditorWrapper";
import { useDatabase } from "../../hooks/useDatabase";
import { quoteIdentifier } from "../../utils/identifiers";

interface TriggerEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  triggerName?: string;
  tableName?: string;
  schema?: string;
  driver?: string;
  isNewTrigger?: boolean;
  onSuccess?: () => void;
}

const TIMING_OPTIONS = ["BEFORE", "AFTER", "INSTEAD OF"];
const EVENT_OPTIONS = ["INSERT", "UPDATE", "DELETE"];

function parseTriggerSql(sql: string): { timing: string | null; events: string[] | null; body: string | null } {
  // Restrict header to the part before FOR EACH ROW to avoid matching keywords in the body
  const forEachRowMatch = sql.match(/\bFOR\s+EACH\s+ROW\b/i);
  const header = forEachRowMatch?.index !== undefined ? sql.slice(0, forEachRowMatch.index) : sql;

  const timingMatch = header.match(/\b(INSTEAD\s+OF|BEFORE|AFTER)\b/i);
  const timing = timingMatch ? timingMatch[1].toUpperCase().replace(/\s+/, " ") : null;

  const eventMatch = header.match(/\b(INSERT|UPDATE|DELETE)\b/i);
  const events = eventMatch ? [eventMatch[1].toUpperCase()] : null;

  const body = forEachRowMatch?.index !== undefined
    ? sql.slice(forEachRowMatch.index + forEachRowMatch[0].length).trim()
    : null;

  return { timing, events, body };
}

export const TriggerEditorModal = ({
  isOpen,
  onClose,
  connectionId,
  triggerName,
  tableName: initialTableName,
  schema: schemaProp,
  driver,
  isNewTrigger = false,
  onSuccess,
}: TriggerEditorModalProps) => {
  const { t } = useLingui();
  const { activeSchema } = useDatabase();
  const resolvedSchema = schemaProp ?? activeSchema ?? undefined;
  const { showAlert } = useAlert();

  const [name, setName] = useState("");
  const [tableName, setTableName] = useState(initialTableName ?? "");
  const [timing, setTiming] = useState("BEFORE");
  const [events, setEvents] = useState<string[]>(["INSERT"]);
  const [body, setBody] = useState("BEGIN\n  -- trigger body\nEND");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawSql, setRawSql] = useState("");
  const [useRawSql, setUseRawSql] = useState(false);

  const loadTriggerDefinition = useCallback(async (tName: string, tTable: string) => {
    setLoading(true);
    setError(null);
    try {
      const def = await invoke<string>("get_trigger_definition", {
        connectionId,
        triggerName: tName,
        tableName: tTable,
        ...(resolvedSchema ? { schema: resolvedSchema } : {}),
      });
      setRawSql(def);

      // Populate guided mode fields so switching tabs shows real values
      const parsed = parseTriggerSql(def);
      if (parsed.timing && TIMING_OPTIONS.includes(parsed.timing)) {
        setTiming(parsed.timing);
      }
      if (parsed.events) {
        setEvents(parsed.events);
      }
      if (parsed.body) {
        setBody(parsed.body);
      }
    } catch (e) {
      setError(t`Failed to load trigger definition: ` + String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, t, resolvedSchema]);

  useEffect(() => {
    if (isOpen) {
      if (isNewTrigger) {
        setName("");
        setTableName(initialTableName ?? "");
        setTiming("BEFORE");
        setEvents(["INSERT"]);
        setBody("BEGIN\n  -- trigger body\nEND");
        setRawSql("");
        setUseRawSql(false);
        setError(null);
      } else if (triggerName && initialTableName) {
        setName(triggerName);
        setTableName(initialTableName);
        loadTriggerDefinition(triggerName, initialTableName);
      }
    }
  }, [isOpen, triggerName, initialTableName, isNewTrigger, loadTriggerDefinition]);

  const buildTriggerSql = (): string => {
    if (useRawSql) return rawSql;
    const q = (id: string) => quoteIdentifier(id, driver ?? "postgres");
    // MySQL handles schema via the connection — including it in the ON clause causes error 1435
    const isMysql = driver === "mysql";
    const schemaPrefix = (!isMysql && resolvedSchema) ? `${q(resolvedSchema)}.` : "";
    const eventStr = events.join(" OR ");
    return [
      `CREATE TRIGGER ${q(name)}`,
      `${timing} ${eventStr}`,
      `ON ${schemaPrefix}${q(tableName)}`,
      `FOR EACH ROW`,
      body,
    ].join("\n");
  };

  const toggleEvent = (ev: string) => {
    setEvents(prev =>
      prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]
    );
  };

  const handleSave = async () => {
    const sql = buildTriggerSql();
    if (!sql.trim()) {
      showAlert(t`Trigger SQL is required`, { kind: "error" });
      return;
    }

    if (!isNewTrigger) {
      const confirmed = await ask(
        t`Editing a trigger requires dropping and recreating it. Continue modifying "${name}"?`,
        { title: t`Recreate Trigger`, kind: "warning" }
      );
      if (!confirmed) return;

      try {
        await invoke("drop_trigger", {
          connectionId,
          triggerName: name,
          tableName,
          ...(resolvedSchema ? { schema: resolvedSchema } : {}),
        });
      } catch (e) {
        setError(t`Failed to drop existing trigger: ` + String(e));
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await invoke("create_trigger", {
        connectionId,
        triggerSql: sql,
        ...(resolvedSchema ? { schema: resolvedSchema } : {}),
      });
      showAlert(
        isNewTrigger ? t`Trigger created successfully` : t`Trigger updated successfully`,
        { kind: "info" }
      );
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(t`Failed to save trigger: ` + String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[800px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-900/30 rounded-lg">
              <Zap size={20} className="text-yellow-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {isNewTrigger ? t`Create Trigger` : t`Edit Trigger`}
              </h2>
              <p className="text-xs text-secondary">
                {isNewTrigger
                  ? t`Create a new database trigger`
                  : t`Editing trigger: ${name}`}
              </p>
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
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="bg-red-900/20 border border-red-900/50 text-red-400 px-4 py-3 rounded-lg flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="text-sm">{error}</div>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-muted text-sm">
              <Loader2 size={14} className="animate-spin" />
              {t`Loading trigger definition...`}
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseRawSql(false)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${!useRawSql ? "bg-blue-600 text-white" : "text-secondary hover:text-primary border border-strong"}`}
            >
              {t`Guided`}
            </button>
            <button
              onClick={() => setUseRawSql(true)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${useRawSql ? "bg-blue-600 text-white" : "text-secondary hover:text-primary border border-strong"}`}
            >
              {t`Raw SQL`}
            </button>
          </div>

          {useRawSql ? (
            <div>
              <label className="text-xs uppercase font-bold text-muted mb-1 block">
                {t`Raw SQL`}
              </label>
              <div className="border border-strong rounded-lg overflow-hidden h-64">
                <SqlEditorWrapper
                  initialValue={rawSql}
                  onChange={setRawSql}
                  height="100%"
                  options={{ readOnly: loading }}
                  onRun={handleSave}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Trigger name */}
              <div>
                <label htmlFor="trigger-name" className="text-xs uppercase font-bold text-muted mb-1 block">
                  {t`Trigger Name`}
                </label>
                <input
                  id="trigger-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isNewTrigger}
                  className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none disabled:opacity-50"
                  placeholder={t`e.g. before_insert_user`}
                  autoFocus={isNewTrigger}
                />
              </div>

              {/* Table name */}
              <div>
                <label htmlFor="trigger-table" className="text-xs uppercase font-bold text-muted mb-1 block">
                  {t`Table Name`}
                </label>
                <input
                  id="trigger-table"
                  type="text"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  disabled={!isNewTrigger}
                  className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none disabled:opacity-50"
                  placeholder={t`e.g. users`}
                />
              </div>

              {/* Timing + Events row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs uppercase font-bold text-muted mb-1 block">
                    {t`Timing`}
                  </label>
                  <div className="flex gap-2">
                    {TIMING_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setTiming(opt)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors border ${timing === opt ? "bg-blue-600 border-blue-600 text-white" : "border-strong text-secondary hover:text-primary"}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs uppercase font-bold text-muted mb-1 block">
                    {t({ message: "Events", context: "triggers" })}
                  </label>
                  <div className="flex gap-2">
                    {EVENT_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => toggleEvent(opt)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors border ${events.includes(opt) ? "bg-blue-600 border-blue-600 text-white" : "border-strong text-secondary hover:text-primary"}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Trigger body */}
              <div>
                <label className="text-xs uppercase font-bold text-muted mb-1 block">
                  {t`Trigger Body (SQL)`}
                </label>
                <div className="border border-strong rounded-lg overflow-hidden h-48">
                  <SqlEditorWrapper
                    initialValue={body}
                    onChange={setBody}
                    height="100%"
                    onRun={handleSave}
                  />
                </div>
              </div>

              {/* SQL preview */}
              <div className="border border-default rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-base border-b border-default text-xs text-muted font-mono">
                  {t`Generated SQL Preview`}
                </div>
                <pre className="p-3 text-xs text-secondary font-mono whitespace-pre-wrap overflow-auto max-h-32">
                  {buildTriggerSql()}
                </pre>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t`Cancel`}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {isNewTrigger ? t`Create Trigger` : t`Save Changes`}
          </button>
        </div>
      </div>
    </div>
  );
};
