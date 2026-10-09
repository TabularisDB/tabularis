import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, Zap, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useAlert } from "../../hooks/useAlert";
import { Modal } from "../ui/Modal";
import { SqlEditorWrapper } from "../ui/SqlEditorWrapper";
import { useDatabase } from "../../hooks/useDatabase";
import { quoteIdentifier } from "../../utils/identifiers";
import type { DriverCapabilities } from "../../types/plugins";
import {
  TRIGGER_CAPS,
  buildCreateTriggerStatements,
  defaultTriggerBody,
  normalizeSelection,
  parseTriggerDefinition,
  resolveTriggerDialect,
  splitSqlStatements,
  type TriggerDialect,
  type TriggerEvent,
  type TriggerTiming,
} from "../../utils/triggerSql";

interface TriggerEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  triggerName?: string;
  tableName?: string;
  schema?: string;
  driver?: string;
  /** Capability-driven identifier quoting (issue #614): when available,
   * takes precedence over the bare `driver` id/fallback so a
   * postgres-compatible driver registered under a different id (e.g. a
   * standalone PostgreSQL plugin) is quoted the same as the builtin
   * "postgres" driver. */
  capabilities?: DriverCapabilities | null;
  isNewTrigger?: boolean;
  onSuccess?: () => void;
}

interface ParsedTrigger {
  timing: TriggerTiming | null;
  events: TriggerEvent[];
  /** mysql/sqlite: text after FOR EACH ROW */
  body: string | null;
  /** postgres: text after FOR EACH ROW|STATEMENT (WHEN ... EXECUTE FUNCTION fn()) */
  tail: string | null;
  forEach: "ROW" | "STATEMENT";
}

function parseTriggerSql(sql: string, dialect: TriggerDialect): ParsedTrigger {
  // Restrict header to the part before FOR EACH to avoid matching keywords in the body
  const m = sql.match(/\bFOR\s+EACH\s+(ROW|STATEMENT)\b/i);
  const hasSplit = m?.index !== undefined;
  const header = hasSplit ? sql.slice(0, m!.index) : sql;
  const rest = hasSplit ? sql.slice(m!.index! + m![0].length).trim() : null;
  const { timing, events } = parseTriggerDefinition(header);
  const forEach = m && m[1].toUpperCase() === "STATEMENT" ? "STATEMENT" : "ROW";

  return dialect === "postgres"
    ? { timing, events, body: null, tail: rest, forEach }
    : { timing, events, body: rest, tail: null, forEach };
}

export const TriggerEditorModal = ({
  isOpen,
  onClose,
  connectionId,
  triggerName,
  tableName: initialTableName,
  schema: schemaProp,
  driver,
  capabilities,
  isNewTrigger = false,
  onSuccess,
}: TriggerEditorModalProps) => {
  const { t } = useTranslation();
  const { activeSchema } = useDatabase();
  const resolvedSchema = schemaProp ?? activeSchema ?? undefined;
  const { showAlert } = useAlert();

  const dialect = resolveTriggerDialect(driver);
  const caps = TRIGGER_CAPS[dialect];

  const [name, setName] = useState("");
  const [tableName, setTableName] = useState(initialTableName ?? "");
  const [timing, setTiming] = useState<TriggerTiming>("BEFORE");
  const [events, setEvents] = useState<TriggerEvent[]>(["INSERT"]);
  const [body, setBody] = useState(defaultTriggerBody(dialect));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawSql, setRawSql] = useState("");
  const [useRawSql, setUseRawSql] = useState(false);
  // Definition as loaded from the database; used to restore it if an edit fails.
  const [originalSql, setOriginalSql] = useState("");
  // Postgres edit: keep the existing trigger function instead of regenerating it.
  const [pgExisting, setPgExisting] = useState<{
    tail: string;
    forEach: "ROW" | "STATEMENT";
  } | null>(null);

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
      setOriginalSql(def);

      // Populate guided mode fields so switching tabs shows real values
      const parsed = parseTriggerSql(def, dialect);
      if (parsed.timing) setTiming(parsed.timing);
      if (parsed.events.length) setEvents(parsed.events);
      if (parsed.body) setBody(parsed.body);
      setPgExisting(
        parsed.tail ? { tail: parsed.tail, forEach: parsed.forEach } : null,
      );
    } catch (e) {
      setError(t("triggers.failLoadDefinition") + String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, t, resolvedSchema, dialect]);

  useEffect(() => {
    if (isOpen) {
      if (isNewTrigger) {
        setName("");
        setTableName(initialTableName ?? "");
        setTiming("BEFORE");
        setEvents(["INSERT"]);
        setBody(defaultTriggerBody(dialect));
        setRawSql("");
        setOriginalSql("");
        setPgExisting(null);
        setUseRawSql(false);
        setError(null);
      } else if (triggerName && initialTableName) {
        setName(triggerName);
        setTableName(initialTableName);
        loadTriggerDefinition(triggerName, initialTableName);
      }
    }
  }, [isOpen, triggerName, initialTableName, isNewTrigger, loadTriggerDefinition, dialect]);

  // Keep timing/events within what the driver supports (e.g. one event on MySQL/SQLite).
  useEffect(() => {
    const n = normalizeSelection(dialect, timing, events);
    if (n.timing !== timing) setTiming(n.timing);
    if (n.events.join() !== events.join()) setEvents(n.events);
  }, [dialect, timing, events]);

  const buildGuidedStatements = (): string[] => {
    const q = (id: string) => quoteIdentifier(id, capabilities ?? driver ?? "postgres");
    return buildCreateTriggerStatements({
      dialect,
      name,
      schema: resolvedSchema,
      table: tableName,
      timing,
      events,
      forEach: pgExisting?.forEach ?? "ROW",
      body,
      quote: q,
      existingTail: !isNewTrigger && pgExisting ? pgExisting.tail : undefined,
    });
  };

  const buildStatements = (): string[] => {
    if (useRawSql) {
      return dialect === "postgres" ? splitSqlStatements(rawSql) : [rawSql];
    }
    return buildGuidedStatements();
  };

  const buildTriggerSql = (): string =>
    useRawSql ? rawSql : buildGuidedStatements().join("\n\n");

  const toggleEvent = (ev: TriggerEvent) => {
    if (!caps.multiEvent) {
      setEvents([ev]);
      return;
    }
    setEvents(prev =>
      prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]
    );
  };

  const switchToRaw = () => {
    // Start raw mode from what guided mode would generate (valid for this dialect).
    if (!rawSql.trim()) setRawSql(buildGuidedStatements().join("\n\n"));
    setUseRawSql(true);
  };

  const createAll = async (statements: string[]) => {
    for (const triggerSql of statements) {
      await invoke("create_trigger", {
        connectionId,
        triggerSql,
        ...(resolvedSchema ? { schema: resolvedSchema } : {}),
      });
    }
  };

  const handleSave = async () => {
    const statements = buildStatements().filter(s => s.trim());
    if (statements.length === 0) {
      showAlert(t("triggers.sqlRequired"), { kind: "error" });
      return;
    }

    if (!isNewTrigger) {
      const confirmed = await ask(
        t("triggers.confirmRecreate", { trigger: name }),
        { title: t("triggers.recreateTrigger"), kind: "warning" }
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setError(null);

    if (!isNewTrigger) {
      try {
        await invoke("drop_trigger", {
          connectionId,
          triggerName: name,
          tableName,
          ...(resolvedSchema ? { schema: resolvedSchema } : {}),
        });
      } catch (e) {
        setError(t("triggers.dropError") + String(e));
        setSaving(false);
        return;
      }
    }

    try {
      await createAll(statements);
      showAlert(
        isNewTrigger ? t("triggers.createSuccess") : t("triggers.updateSuccess"),
        { kind: "info" }
      );
      onSuccess?.();
      onClose();
    } catch (e) {
      let message = t("triggers.saveError") + String(e);
      if (!isNewTrigger && originalSql.trim()) {
        // The old trigger was already dropped: put it back so a failed edit loses nothing.
        try {
          await createAll(
            dialect === "postgres" ? splitSqlStatements(originalSql) : [originalSql]
          );
          message += "\n" + t("triggers.originalRestored", "The original trigger was restored.");
        } catch (restoreError) {
          message +=
            "\n" +
            t("triggers.restoreFailed", "Restoring the original trigger also failed: ") +
            String(restoreError);
        }
      }
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const keepsExistingFunction = !isNewTrigger && dialect === "postgres" && !!pgExisting;

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[800px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-warning/15 rounded-lg">
              <Zap size={20} className="text-accent-warning" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {isNewTrigger ? t("triggers.createTrigger") : t("triggers.editTrigger")}
              </h2>
              <p className="text-xs text-secondary">
                {isNewTrigger
                  ? t("triggers.createSubtitle")
                  : t("triggers.editSubtitle", { name })}
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
            <div className="bg-accent-error/10 border border-accent-error/25 text-accent-error px-4 py-3 rounded-lg flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="text-sm whitespace-pre-wrap">{error}</div>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-muted text-sm">
              <Loader2 size={14} className="animate-spin" />
              {t("triggers.loading")}
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseRawSql(false)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${!useRawSql ? "bg-accent-primary text-inverse" : "text-secondary hover:text-primary border border-strong"}`}
            >
              {t("triggers.guidedMode")}
            </button>
            <button
              onClick={switchToRaw}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${useRawSql ? "bg-accent-primary text-inverse" : "text-secondary hover:text-primary border border-strong"}`}
            >
              {t("triggers.rawSqlMode")}
            </button>
          </div>

          {useRawSql ? (
            <div>
              <label className="text-xs uppercase font-bold text-muted mb-1 block">
                {t("triggers.rawSql")}
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
                  {t("triggers.triggerName")}
                </label>
                <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                  id="trigger-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isNewTrigger}
                  className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-focus focus:outline-none disabled:opacity-50"
                  placeholder={t("triggers.triggerNamePlaceholder")}
                  autoFocus={isNewTrigger}
                />
              </div>

              {/* Table name */}
              <div>
                <label htmlFor="trigger-table" className="text-xs uppercase font-bold text-muted mb-1 block">
                  {t("triggers.tableName")}
                </label>
                <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                  id="trigger-table"
                  type="text"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  disabled={!isNewTrigger}
                  className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-focus focus:outline-none disabled:opacity-50"
                  placeholder={t("triggers.tableNamePlaceholder")}
                />
              </div>

              {/* Timing + Events row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs uppercase font-bold text-muted mb-1 block">
                    {t("triggers.timing")}
                  </label>
                  <div className="flex gap-2">
                    {caps.timings.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setTiming(opt)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors border ${timing === opt ? "bg-accent-primary border-accent-primary text-inverse" : "border-strong text-secondary hover:text-primary"}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs uppercase font-bold text-muted mb-1 block">
                    {t("triggers.events")}
                  </label>
                  <div className="flex gap-2">
                    {caps.events.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => toggleEvent(opt)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors border ${events.includes(opt) ? "bg-accent-primary border-accent-primary text-inverse" : "border-strong text-secondary hover:text-primary"}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  {!caps.multiEvent && (
                    <p className="text-xs text-muted mt-1">
                      {t("triggers.singleEventHint", "This database allows one event per trigger.")}
                    </p>
                  )}
                </div>
              </div>

              {/* Trigger body */}
              {keepsExistingFunction ? (
                <p className="text-xs text-muted">
                  {t(
                    "triggers.existingFunctionHint",
                    "This trigger keeps its existing function. Edit the function itself in the SQL editor or raw SQL mode."
                  )}
                </p>
              ) : (
                <div>
                  <label className="text-xs uppercase font-bold text-muted mb-1 block">
                    {t("triggers.body")}
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
              )}

              {/* SQL preview */}
              <div className="border border-default rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-base border-b border-default text-xs text-muted font-mono">
                  {t("triggers.sqlPreview")}
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
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-50 text-inverse rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {isNewTrigger ? t("triggers.create") : t("triggers.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
};