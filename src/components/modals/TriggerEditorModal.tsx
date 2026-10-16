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
  buildTriggerFunctionSql as buildTriggerFunctionSqlUtil,
  buildTriggerSql as buildTriggerSqlUtil,
  triggerFunctionName,
  extractFunctionBody,
  parseTriggerFunctionName,
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
  type TriggerSqlInput,
} from "../../utils/triggerSql";
import { quoteIdentifier } from "../../utils/identifiers";
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
  tableName: initialTableName,
  triggerName,
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

const resolvedDialect = resolveTriggerDialect({ driver, capabilities });
const unsupported = resolvedDialect === null;
// Placeholder so hooks and helpers keep a valid dialect; never used to run SQL when unsupported.
const dialect: TriggerDialect = resolvedDialect ?? "postgres";
const caps = TRIGGER_CAPS[dialect];

  const [name, setName] = useState("");
  const [tableName, setTableName] = useState(initialTableName ?? "");
  const [timing, setTiming] = useState<TriggerTiming>("BEFORE");
  const [events, setEvents] = useState<TriggerEvent[]>(["INSERT"]);
  // The real function an EXISTING trigger's EXECUTE FUNCTION|PROCEDURE clause
  // references, as parsed on load — distinct from the generated
  // <table>_<name>_fn convention. When set, save updates THIS function
  // instead of creating (or clobbering) a convention-named one; null means
  // either a brand-new trigger (no existing function to preserve) or an
  // existing one whose function name couldn't be parsed, in which case save
  // falls back to the collision-checked convention-name path.
  const [existingFunctionName, setExistingFunctionName] = useState<
    { name: string; schema?: string } | null
  >(null);
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
    setExistingFunctionName(null);
    try {
      const def = await invoke<string>("get_trigger_definition", {
        connectionId,
        triggerName: tName,
        tableName: tTable,
        ...(resolvedSchema ? { schema: resolvedSchema } : {}),
        ...(database ? { database } : {}),
      });
      setRawSql(def);
      setOriginalSql(def);

      // Populate guided mode fields so switching tabs shows real values
      const parsed = parseTriggerSql(def, dialect);
      const norm = normalizeSelection(
        dialect,
        parsed.timing ?? "BEFORE",
        parsed.events.length ? parsed.events : ["INSERT"],
      );
      setTiming(norm.timing);
      setEvents(norm.events);
      setPgExisting(
        parsed.tail ? { tail: parsed.tail, forEach: parsed.forEach } : null,
      );
      if (parsed.body) setBody(parsed.body);
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
      // lookup and fall back to the invalid EXECUTE string.
      if (dialect === "postgres" && parsed.tail && /\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\b/i.test(parsed.tail)) {
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
          }
          // Record the function's real identity ONLY when it was actually
          // parsed from the EXECUTE clause — not the convention-name
          // fallback above, which exists to still attempt a body fetch,
          // not to assert that's the function this trigger truly calls.
          // Save uses this to update that function in place; when it's
          // null (parsing failed), save falls back to the collision-
          // checked convention-name path instead of guessing wrong.
          if (parsedFnName) {
            setExistingFunctionName({ name: fnName, schema: fnSchema });
          }
        } catch {
          // Can't fetch the function definition — existingFunctionName
          // stays null; save falls back to the convention-name path.
        }
      }
    } catch (e) {
      setError(t("triggers.failLoadDefinition") + String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, t, resolvedSchema, dialect, database]);

  useEffect(() => {
    if (!isOpen || unsupported) return;
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
      setExistingFunctionName(null);
    } else if (triggerName && initialTableName) {
      setName(triggerName);
      setTableName(initialTableName);
      loadTriggerDefinition(triggerName, initialTableName);
    }
  }, [isOpen, unsupported, triggerName, initialTableName, isNewTrigger, loadTriggerDefinition, dialect]);

  // Our trigger-identity helpers: used by the PG guided-edit save path to
  // create/replace the function the trigger actually calls (by its real name,
  // not the convention) before dropping/recreating the trigger.
  const sqlInput: TriggerSqlInput = {
    name,
    tableName,
    schema: resolvedSchema,
    timing,
    events,
    body,
    driver,
    capabilities,
    ...(existingFunctionName ? { existingFunctionName } : {}),
  };
  const buildTriggerFunctionSql = () => buildTriggerFunctionSqlUtil(sqlInput);
  const buildTriggerSqlUtilFn = (): string => buildTriggerSqlUtil(sqlInput);

  // Upstream's dialect-aware multi-statement builder: used by the CREATE path
  // and non-PG/raw-mode flows. For PG with an existing function (edit), this
  // re-emits the EXECUTE FUNCTION tail verbatim (no function re-creation).
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

  // What the "Generated SQL Preview" panel shows. For PostgreSQL guided edit
  // this is both statements handleSave actually runs — the function on its own
  // isn't meaningful to review without the trigger that will call it.
  const buildPreviewSql = (): string => {
    if (useRawSql) return rawSql;
    if (dialect === "postgres" && !isNewTrigger && existingFunctionName) {
      return `${buildTriggerFunctionSql()}\n\n${buildTriggerSqlUtilFn()}`;
    }
    return buildGuidedStatements().join("\n\n");
  };

 const toggleEvent = (ev: TriggerEvent) => {
  const next = !caps.multiEvent
    ? [ev]
    : events.includes(ev)
      ? events.filter((e) => e !== ev)
      : [...events, ev];
  const norm = normalizeSelection(dialect, timing, next);
  setTiming(norm.timing);
  setEvents(norm.events);
};

  const selectTiming = (next: TriggerTiming) => {
    const norm = normalizeSelection(dialect, next, events);
    setTiming(norm.timing);
    setEvents(norm.events);
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
        ...(resolvedSchema ? { schema: resolvedSchema } : {})
      });
    }
  };

  const handleSave = async () => {
    if (unsupported) return;
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

    // PostgreSQL guided edit with a parsed existing function: use the
    // function-first save path. CREATE OR REPLACE FUNCTION runs BEFORE
    // drop_trigger so a function-creation failure leaves the existing
    // trigger intact (the drop never happens). This also preserves the
    // function's real identity — updating the function the trigger
    // actually calls, not a convention-named orphan.
    const pgGuidedEdit = dialect === "postgres" && !useRawSql && !isNewTrigger && existingFunctionName;
    if (pgGuidedEdit) {
      let triggerDropped = false;
      try {
        await invoke("execute_query", {
          connectionId,
          query: buildTriggerFunctionSql(),
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
        triggerDropped = true;
        await invoke("create_trigger", {
          connectionId,
          triggerSql: buildTriggerSqlUtilFn(),
          ...(resolvedSchema ? { schema: resolvedSchema } : {}),
          ...(database ? { database } : {}),
        });
        showAlert(t("triggers.updateSuccess"), { kind: "info" });
        onSuccess?.();
        onClose();
      } catch (e) {
        let message = t("triggers.saveError") + String(e);
        // Only restore if the trigger was actually dropped — if the function
        // step failed (before the drop), the original trigger is still intact
        // and restoring would create a duplicate.
        if (triggerDropped && originalSql.trim()) {
          try {
            await createAll(splitSqlStatements(originalSql));
            message += "\n" + t("triggers.originalRestored");
          } catch (restoreError) {
            message += "\n" + t("triggers.restoreFailed") + String(restoreError);
          }
        }
        setError(message);
      } finally {
        setSaving(false);
      }
      return;
    }

    // All other paths (new trigger, non-PG, raw mode, or PG edit without a
    // parsed function name): drop-then-create with safe-restore on failure.
    // PostgreSQL new trigger (guided): probe that no unrelated function
    // already owns the generated convention name — refuse BEFORE dropping so
    // a collision never leaves the existing trigger gone.
    if (dialect === "postgres" && !useRawSql && (isNewTrigger || !existingFunctionName)) {
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
        setSaving(false);
        return;
      } catch {
        // The function doesn't exist — expected for a new trigger; proceed.
      }
    }

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
          message += "\n" + t("triggers.originalRestored");
        } catch (restoreError) {
          message +=
          "\n" +
          t("triggers.restoreFailed") +
          String(restoreError);
        }
      }
      setError(message);
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
      ...(existingFunctionName ? { existingFunctionName } : {}),
    };
    // Mirror handleSave's edit-path flow: create/replace function → drop_trigger
    // → create_trigger. The function is created BEFORE the drop so a failure in
    // the function step leaves the existing trigger intact.
    // Also mirrors handleSave's IDENTITY behavior (blocking 4): when the
    // trigger's real function was parsed on load, this updates THAT function
    // (which may be shared with another trigger) rather than a generated
    // convention name.
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

  if (unsupported) {
    return (
      <Modal isOpen={isOpen} onClose={onClose}>
        <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] p-6 space-y-4">
          <div className="flex items-start gap-2 text-accent-error">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <p className="text-sm">{t("triggers.unsupportedDriver")}</p>
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </Modal>
    );
  }
  const keepsExistingFunction = !isNewTrigger && dialect === "postgres" && !!pgExisting && !existingFunctionName;

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
                        onClick={() => selectTiming(opt)}
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
                     {t("triggers.singleEventHint")}
                    </p>
                  )}
                </div>
              </div>

              {/* Trigger body */}
              {keepsExistingFunction ? (
                <p className="text-xs text-muted">
              {t("triggers.existingFunctionHint")}
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
            disabled={saving || loading || unsupported}
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