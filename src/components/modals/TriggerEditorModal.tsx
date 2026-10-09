import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, Zap, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useAlert } from "../../hooks/useAlert";
import { Modal } from "../ui/Modal";
import { SqlEditorWrapper } from "../ui/SqlEditorWrapper";
import { useDatabase } from "../../hooks/useDatabase";
import {
  isPostgresDriver,
  defaultTriggerBody,
  buildTriggerFunctionSql as buildTriggerFunctionSqlUtil,
  buildTriggerSql as buildTriggerSqlUtil,
  triggerFunctionName,
  extractFunctionBody,
  parseTriggerFunctionName,
  type TriggerSqlInput,
} from "../../utils/triggerSql";
import type { DriverCapabilities } from "../../types/plugins";

interface TriggerEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  triggerName?: string;
  tableName?: string;
  schema?: string;
  database?: string;
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
  database,
  driver,
  capabilities,
  isNewTrigger = false,
  onSuccess,
}: TriggerEditorModalProps) => {
  const { t } = useTranslation();
  const { activeSchema } = useDatabase();
  const resolvedSchema = schemaProp ?? activeSchema ?? undefined;
  const { showAlert } = useAlert();

  const [name, setName] = useState("");
  const [tableName, setTableName] = useState(initialTableName ?? "");
  const [timing, setTiming] = useState("BEFORE");
  const [events, setEvents] = useState<string[]>(["INSERT"]);
  // PostgreSQL has no inline trigger body — CREATE TRIGGER only references a
  // separate trigger function, so the guided-mode body field holds that
  // function's PL/pgSQL statements instead of a literal BEGIN/END block
  // (see triggerSql.ts and issue #837).
  const isPostgres = isPostgresDriver(driver);
  const [body, setBody] = useState(defaultTriggerBody(driver));
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
        ...(database ? { database } : {}),
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
        // PostgreSQL: the trigger definition's body is `EXECUTE FUNCTION fn()`
        // (or legacy `EXECUTE PROCEDURE fn()`) — not a PL/pgSQL function body.
        // Fetch the actual function definition to get the real body statements,
        // so the guided-save recreates the function with its original logic
        // (not the EXECUTE clause, which is invalid PL/pgSQL and would fail the
        // CREATE OR REPLACE, leaving the already-dropped trigger gone).
        //
        // Parse the real function name from the EXECUTE clause rather than
        // assuming the `<table>_<trigger>_fn` convention — a trigger whose
        // function follows a different naming scheme would otherwise fail the
        // lookup and fall back to the invalid EXECUTE string (debba review, PR
        // #822, blocking 3).
        if (isPostgresDriver(driver) && /\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\b/i.test(parsed.body)) {
          try {
            const parsedFnName = parseTriggerFunctionName(def);
            // A schema-qualified name ("schema.fn") must be split for the RPC,
            // which takes routineName + schema separately; fall back to the
            // trigger's own schema for an unqualified function name.
            let fnName: string;
            let fnSchema: string | undefined;
            if (parsedFnName && parsedFnName.includes(".")) {
              const [s, ...rest] = parsedFnName.split(".");
              fnSchema = s;
              fnName = rest.join(".");
            } else {
              fnName = parsedFnName ?? triggerFunctionName(tName, tTable);
              fnSchema = resolvedSchema;
            }
            const fnDef = await invoke<string>("get_routine_definition", {
              connectionId,
              routineName: fnName,
              routineType: "FUNCTION",
              ...(fnSchema ? { schema: fnSchema } : {}),
              ...(database ? { database } : {}),
            });
            const fnBody = extractFunctionBody(fnDef);
            if (fnBody) {
              setBody(fnBody);
            } else {
              setBody(parsed.body);
            }
          } catch {
            // Can't fetch the function definition — fall back to the parsed
            // body (the user can edit it before saving).
            setBody(parsed.body);
          }
        } else {
          setBody(parsed.body);
        }
      }
    } catch (e) {
      setError(t("triggers.failLoadDefinition") + String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, t, resolvedSchema, database, driver]);

  useEffect(() => {
    if (isOpen) {
      if (isNewTrigger) {
        setName("");
        setTableName(initialTableName ?? "");
        setTiming("BEFORE");
        setEvents(["INSERT"]);
        setBody(defaultTriggerBody(driver));
        setRawSql("");
        setUseRawSql(false);
        setError(null);
      } else if (triggerName && initialTableName) {
        setName(triggerName);
        setTableName(initialTableName);
        loadTriggerDefinition(triggerName, initialTableName);
      }
    }
  }, [isOpen, triggerName, initialTableName, isNewTrigger, loadTriggerDefinition, driver]);

  const sqlInput: TriggerSqlInput = {
    name,
    tableName,
    schema: resolvedSchema,
    timing,
    events,
    body,
    driver,
    capabilities,
  };

  const buildTriggerFunctionSql = () => buildTriggerFunctionSqlUtil(sqlInput);

  const buildTriggerSql = (): string => {
    if (useRawSql) return rawSql;
    return buildTriggerSqlUtil(sqlInput);
  };

  // What the "Generated SQL Preview" panel shows. For PostgreSQL this is
  // both statements handleSave actually runs — the function on its own
  // isn't meaningful to review without the trigger that will call it.
  const buildPreviewSql = (): string => {
    if (useRawSql) return rawSql;
    return isPostgres ? `${buildTriggerFunctionSql()}\n\n${buildTriggerSql()}` : buildTriggerSql();
  };

  const toggleEvent = (ev: string) => {
    setEvents(prev =>
      prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]
    );
  };

  const handleSave = async () => {
    const sql = buildTriggerSql();
    if (!sql.trim()) {
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
    try {
      // PostgreSQL: the trigger function must exist before the trigger can
      // reference it, and the two can't run as one combined statement (neither
      // the builtin driver nor the plugin's Postgres client executes multiple
      // semicolon-separated commands in a single call — see issue #837).
      //
      // ORDERING (debba review, PR #822, blocking 3): create/replace the
      // function BEFORE dropping the existing trigger, so a failure in the
      // function step leaves the existing trigger intact. Previously the drop
      // ran first, so a failed function creation left the trigger gone with no
      // rollback. CREATE OR REPLACE is idempotent for an existing function
      // (the edit path); for a brand-new trigger we first probe that no
      // unrelated function already owns the generated name, so we never
      // silently clobber a user function.
      if (isPostgres && !useRawSql) {
        if (isNewTrigger) {
          // Refuse to silently overwrite an existing function that happens to
          // share the generated name — the user can rename the trigger instead.
          try {
            await invoke<string>("get_routine_definition", {
              connectionId,
              routineName: triggerFunctionName(name, tableName),
              routineType: "FUNCTION",
              ...(resolvedSchema ? { schema: resolvedSchema } : {}),
              ...(database ? { database } : {}),
            });
            setError(
              t("triggers.functionNameCollision", {
                name: triggerFunctionName(name, tableName),
              }),
            );
            return;
          } catch {
            // The function doesn't exist — expected for a new trigger; proceed.
          }
        }
        await invoke("execute_query", {
          connectionId,
          query: buildTriggerFunctionSql(),
          ...(resolvedSchema ? { schema: resolvedSchema } : {}),
          ...(database ? { database } : {}),
        });
      }

      if (!isNewTrigger) {
        // Drop the existing trigger only AFTER the function step succeeded, so
        // a function-creation failure never leaves the trigger dropped.
        try {
          await invoke("drop_trigger", {
            connectionId,
            triggerName: name,
            tableName,
            ...(resolvedSchema ? { schema: resolvedSchema } : {}),
            ...(database ? { database } : {}),
          });
        } catch (e) {
          setError(t("triggers.dropError") + String(e));
          return;
        }
      }

      await invoke("create_trigger", {
        connectionId,
        triggerSql: sql,
        ...(resolvedSchema ? { schema: resolvedSchema } : {}),
        ...(database ? { database } : {}),
      });
      showAlert(
        isNewTrigger ? t("triggers.createSuccess") : t("triggers.updateSuccess"),
        { kind: "info" }
      );
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(t("triggers.saveError") + String(e));
    } finally {
      setSaving(false);
    }
  };

  // E2E: expose hooks for tauri-wd tests. The Monaco editor's setValue doesn't
  // reliably update the `body` React state that handleSave reads (onChange is
  // debounced), so expose a direct save-with-body that calls the IPC commands.
  (window as unknown as Record<string, unknown>).__e2e_save_trigger = handleSave;
  (window as unknown as Record<string, unknown>).__e2e_set_trigger_body = setBody;
  (window as unknown as Record<string, unknown>).__e2e_get_trigger_table = () => tableName;
  (window as unknown as Record<string, unknown>).__e2e_save_trigger_with_body = async (body: string) => {
    const input = {
      name, tableName, schema: resolvedSchema, timing, events,
      body, driver, capabilities,
    };
    // Mirror handleSave's edit-path flow: create/replace function → drop_trigger
    // → create_trigger. The function is created BEFORE the drop so a failure in
    // the function step leaves the existing trigger intact (debba review, #822).
    const fnSql = buildTriggerFunctionSqlUtil(input);
    await invoke("execute_query", {
      connectionId,
      query: fnSql,
      ...(resolvedSchema ? { schema: resolvedSchema } : {}),
      ...(database ? { database } : {}),
    });
    await invoke("drop_trigger", {
      connectionId,
      triggerName: name,
      tableName,
      ...(resolvedSchema ? { schema: resolvedSchema } : {}),
      ...(database ? { database } : {}),
    });
    const triggerSql = buildTriggerSqlUtil(input);
    await invoke("create_trigger", {
      connectionId,
      triggerSql,
      ...(resolvedSchema ? { schema: resolvedSchema } : {}),
      ...(database ? { database } : {}),
    });
  };

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
              <div className="text-sm">{error}</div>
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
              onClick={() => setUseRawSql(true)}
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
                    {TIMING_OPTIONS.map((opt) => (
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
                    {EVENT_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => toggleEvent(opt)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors border ${events.includes(opt) ? "bg-accent-primary border-accent-primary text-inverse" : "border-strong text-secondary hover:text-primary"}`}
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

              {/* SQL preview */}
              <div className="border border-default rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-base border-b border-default text-xs text-muted font-mono">
                  {t("triggers.sqlPreview")}
                </div>
                <pre className="p-3 text-xs text-secondary font-mono whitespace-pre-wrap overflow-auto max-h-32">
                  {buildPreviewSql()}
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
