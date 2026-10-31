import { useCallback, useEffect, useState, type ReactNode } from "react";
import { openUrl, usePluginRpc, usePluginTranslation, type PluginQueryResult } from "@tabularis/plugin-api";
import { useTask } from "./hooks/useTask";
import { DataTable } from "./components/DataTable";
import { credentialNames, CredentialParseError, parseCredentials, type CredentialError } from "./utils/credentials";
import { objectRows } from "./utils/data";
import { styles } from "./styles";

type Tab = "overview" | "database" | "users" | "storage" | "ai" | "functions" | "realtime" | "setup";
interface ConnectedProps { connectionId: string }
interface NeonStatus {
  connectionId: string;
  branch: string;
  projectId: string | null;
  database: PluginQueryResult;
  services: { name: string; configured: boolean }[];
}

export function NeonPanel({ connectionId, connectionName }: { connectionId: string | null; connectionName?: string }) {
  const t = usePluginTranslation("neon");
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: Tab[] = ["overview", "database", "users", "storage", "ai", "functions", "realtime", "setup"];
  let content: ReactNode;
  if (!connectionId) content = <div className="neon-empty">{t("noConnection")}</div>;
  else if (tab === "overview") content = <Overview connectionId={connectionId} />;
  else if (tab === "database" || tab === "users") content = <QueryView key={tab} connectionId={connectionId} kind={tab} />;
  else if (tab === "storage") content = <Storage connectionId={connectionId} />;
  else if (tab === "ai") content = <Ai connectionId={connectionId} />;
  else if (tab === "functions") content = <Functions connectionId={connectionId} />;
  else if (tab === "realtime") content = <Realtime connectionId={connectionId} />;
  else content = <Setup connectionId={connectionId} />;
  return <div className="neon-panel">
    <style>{styles}</style>
    <div className="neon-head"><div><strong title={connectionId ?? undefined}>{connectionName ?? t("selectedConnection")}</strong><p>{connectionId ? t("connectionTools") : t("selectConnection")}</p></div><ConsoleLink /></div>
    <div className="neon-shell">
      <nav className="neon-nav" role="tablist" aria-label={t("services")} aria-orientation="vertical">{tabs.map((item, index) => <button key={item} id={`neon-tab-${item}`} role="tab" aria-controls="neon-content" aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} disabled={!connectionId} onClick={() => setTab(item)} onKeyDown={event => {
        const offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
        const target = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
        if (!offset && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        setTab(tabs[target]);
        const buttons = event.currentTarget.parentElement?.querySelectorAll("button");
        buttons?.[target]?.focus();
      }}>{t(`tabs.${item}`)}</button>)}</nav>
      <section className="neon-main" id="neon-content" role="tabpanel" aria-labelledby={`neon-tab-${tab}`}>{content}</section>
    </div>
  </div>;
}

function ConsoleLink() {
  const t = usePluginTranslation("neon");
  const task = useTask<void>();
  return <div><button className="neon-link" disabled={task.pending} onClick={() => void task.run(() => openUrl("https://console.neon.tech"))}>{t("console")}</button><Feedback {...task} /></div>;
}

function Feedback({ pending, error, waiting = false }: { pending: boolean; error?: string; waiting?: boolean }) {
  const t = usePluginTranslation("neon");
  return <>{pending && <div className="neon-feedback" role="status">{t(waiting ? "waiting" : "loading")}</div>}{error && <div className="neon-feedback neon-error" role="alert">{error}</div>}</>;
}

function Overview({ connectionId }: ConnectedProps) {
  const t = usePluginTranslation("neon");
  const { call } = usePluginRpc("neon", connectionId);
  const task = useTask<NeonStatus>();
  const { run } = task;
  const branches = useTask<Record<string, unknown>[]>();
  const load = useCallback(() => run(() => call<NeonStatus>("neon_status")), [call, run]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return <>
    <h3>{t("tabs.overview")}</h3><p>{t("overviewDescription")}</p>
    <button className="neon-button" disabled={task.pending} onClick={() => void load()}>{t("refresh")}</button>
    <Feedback {...task} />
    {task.data && <><div className="neon-row"><span>{t("branch")}</span><code>{task.data.branch}</code>{task.data.projectId && <code>{task.data.projectId}</code>}</div>
      {task.data.services.map(service => <div className="neon-service" key={service.name}><span>{service.name}</span><span>{t(service.configured ? "configured" : "needsSetup")}</span></div>)}
      <DataTable data={task.data.database} /></>}
    <div className="neon-row"><button className="neon-button" disabled={branches.pending} onClick={() => void branches.run(() => call("neon_project_branches"))}>{t("loadBranches")}</button></div>
    <p className="neon-small">{t("branchesHint")}</p><Feedback {...branches} />{branches.data && <DataTable data={objectRows(branches.data)} />}
  </>;
}

function QueryView({ connectionId, kind }: ConnectedProps & { kind: "database" | "users" }) {
  const t = usePluginTranslation("neon");
  const { call } = usePluginRpc("neon", connectionId);
  const task = useTask<PluginQueryResult>();
  const { run } = task;
  const load = useCallback(() => run(() => call<PluginQueryResult>(kind === "users" ? "neon_auth_users" : "neon_demo_notes")), [call, kind, run]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return <><h3>{t(`tabs.${kind}`)}</h3><p>{t(`${kind}Description`)}</p><button className="neon-button" disabled={task.pending} onClick={() => void load()}>{t("refresh")}</button><Feedback {...task} />{task.data && <><DataTable data={task.data} /><p className="neon-small">{t("rowCount", { count: task.data.rows.length })}</p></>}</>;
}

interface StoredObject { Key: string; Size?: number; LastModified?: string }

function Storage({ connectionId }: ConnectedProps) {
  const t = usePluginTranslation("neon");
  const { call } = usePluginRpc("neon", connectionId);
  const listing = useTask<StoredObject[]>();
  const action = useTask<{ body?: string; message?: string }>();
  const [prefix, setPrefix] = useState("");
  const [key, setKey] = useState("tabularis/hello.txt");
  const [body, setBody] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPut, setConfirmPut] = useState(false);
  const load = () => listing.run(() => call("neon_storage_list", { prefix }));
  const mutate = async (method: "neon_storage_put" | "neon_storage_delete") => {
    setConfirmDelete(false); setConfirmPut(false);
    const result = await action.run(async () => { await call(method, method === "neon_storage_put" ? { key, body } : { key }); return { message: t(method === "neon_storage_put" ? "objectSaved" : "objectDeleted") }; });
    if (result) void load();
  };
  return <><h3>{t("tabs.storage")}</h3><p>{t("storageDescription")}</p>
    <label htmlFor="neon-prefix">{t("prefix")}</label><input id="neon-prefix" value={prefix} onChange={event => setPrefix(event.target.value)} />
    <div className="neon-row"><button className="neon-button" disabled={listing.pending} onClick={() => void load()}>{t("listObjects")}</button></div><Feedback {...listing} />
    {listing.data && (listing.data.length ? <div className="neon-grid"><table><thead><tr><th>{t("objectKey")}</th><th>{t("bytes")}</th><th>{t("modified")}</th></tr></thead><tbody>{listing.data.map(item => <tr key={item.Key}><td><button className="neon-link" onClick={() => { setKey(item.Key); setConfirmDelete(false); setConfirmPut(false); }}>{item.Key}</button></td><td>{item.Size ?? "—"}</td><td>{item.LastModified ?? "—"}</td></tr>)}</tbody></table></div> : <div className="neon-empty">{t("empty")}</div>)}
    <label htmlFor="neon-key">{t("objectKey")}</label><input id="neon-key" value={key} disabled={action.pending} onChange={event => { setKey(event.target.value); setConfirmDelete(false); setConfirmPut(false); }} />
    <label htmlFor="neon-body">{t("objectBody")}</label><textarea id="neon-body" value={body} disabled={action.pending} onChange={event => { setBody(event.target.value); setConfirmPut(false); }} placeholder={t("bodyPlaceholder")} />
    <div className="neon-row"><button className="neon-button" disabled={action.pending || !key.trim()} onClick={() => void action.run(() => call("neon_storage_get", { key }))}>{t("readObject")}</button><button className="neon-button neon-button-primary" disabled={action.pending || !key.trim() || !body} onClick={() => { setConfirmPut(true); setConfirmDelete(false); }}>{t("saveObject")}</button><button className="neon-button neon-button-danger" disabled={action.pending || !key.trim()} onClick={() => { setConfirmDelete(true); setConfirmPut(false); }}>{t("deleteObject")}</button></div>
    {(confirmDelete || confirmPut) && <div className="neon-feedback"><p>{t(confirmDelete ? "deleteObjectConfirm" : "putObjectConfirm", { key })}</p><div className="neon-row"><button className="neon-button neon-button-danger" onClick={() => void mutate(confirmDelete ? "neon_storage_delete" : "neon_storage_put")}>{t("confirm")}</button><button className="neon-button" onClick={() => { setConfirmDelete(false); setConfirmPut(false); }}>{t("cancel")}</button></div></div>}
    <Feedback {...action} />{action.data?.message && <div className="neon-feedback neon-ok" role="status">{action.data.message}</div>}{action.data?.body !== undefined && <pre className="neon-output">{action.data.body}</pre>}
  </>;
}

function Ai({ connectionId }: ConnectedProps) {
  const t = usePluginTranslation("neon");
  const { call } = usePluginRpc("neon", connectionId);
  const models = useTask<{ data: { id: string; enabled?: boolean }[] }>();
  const completion = useTask<{ choices?: { message?: { content?: string } }[] }>();
  const [selected, setSelected] = useState("");
  const [prompt, setPrompt] = useState("");
  const available = models.data?.data.filter(model => model.enabled !== false) ?? [];
  const model = selected || available[0]?.id || "";
  return <><h3>{t("tabs.ai")}</h3><p>{t("aiDescription")}</p><button className="neon-button" disabled={models.pending} onClick={() => void models.run(() => call("neon_ai_models"))}>{t("loadModels")}</button><Feedback {...models} />
    {models.data && !available.length && <div className="neon-empty">{t("noModels")}</div>}
    <label htmlFor="neon-model">{t("model")}</label><select id="neon-model" value={model} onChange={event => setSelected(event.target.value)} disabled={!available.length}><option value="" disabled>{t("chooseModel")}</option>{available.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select>
    <label htmlFor="neon-prompt">{t("prompt")}</label><textarea id="neon-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t("promptPlaceholder")} />
    <div className="neon-row"><button className="neon-button neon-button-primary" disabled={!model || !prompt.trim() || completion.pending} onClick={() => void completion.run(() => call("neon_ai_complete", { model, prompt }))}>{t("generate")}</button><span className="neon-small">{t("aiCost")}</span></div><Feedback {...completion} />{completion.data && <pre className="neon-output">{completion.data.choices?.[0]?.message?.content || t("emptyResponse")}</pre>}
  </>;
}

function Functions({ connectionId }: ConnectedProps) {
  const t = usePluginTranslation("neon");
  const { call } = usePluginRpc("neon", connectionId);
  const task = useTask<{ status: number; body: string }>();
  return <><h3>{t("tabs.functions")}</h3><p>{t("functionsDescription")}</p><button className="neon-button neon-button-primary" disabled={task.pending} onClick={() => void task.run(() => call("neon_function"))}>{t("invokeFunction")}</button><Feedback {...task} />{task.data && <><div className="neon-row"><code>HTTP {task.data.status}</code></div><pre className="neon-output">{task.data.body}</pre></>}</>;
}

function Realtime({ connectionId }: ConnectedProps) {
  const t = usePluginTranslation("neon");
  const { call } = usePluginRpc("neon", connectionId);
  const task = useTask<Record<string, unknown>[]>();
  const [query, setQuery] = useState("SELECT id, title, body, updated_at FROM tabularis_demo.notes ORDER BY id LIMIT 20");
  const [column, setColumn] = useState("");
  const [until, setUntil] = useState("");
  const valid = /^\s*select\b/i.test(query) && (!until || !!column.trim());
  return <><h3>{t("tabs.realtime")}</h3><p>{t("realtimeDescription")}</p>
    <label htmlFor="neon-query">{t("readQuery")}</label><textarea id="neon-query" value={query} onChange={event => setQuery(event.target.value)} spellCheck={false} />
    <div className="neon-columns"><div><label htmlFor="neon-column">{t("watchColumn")}</label><input id="neon-column" value={column} onChange={event => setColumn(event.target.value)} placeholder="title" /></div><div><label htmlFor="neon-until">{t("targetValue")}</label><input id="neon-until" value={until} onChange={event => setUntil(event.target.value)} placeholder={t("targetPlaceholder")} /></div></div>
    <div className="neon-row"><button className="neon-button neon-button-primary" disabled={!valid || task.pending} onClick={() => void task.run(() => call("neon_realtime_snapshot", { query, ...(until ? { column, until } : {}) }))}>{t(until ? "waitSnapshot" : "readSnapshot")}</button></div>
    <p className="neon-small">{t("realtimeHint")}</p><Feedback {...task} waiting />{task.data && <><DataTable data={objectRows(task.data)} /><p className="neon-small">{t("snapshotComplete")}</p></>}
  </>;
}

function Setup({ connectionId }: ConnectedProps) {
  const t = usePluginTranslation("neon");
  const { saveSecrets, secretFields, deleteSecrets } = usePluginRpc("neon", connectionId);
  const task = useTask<{ fields: string[]; saved?: boolean; deleted?: boolean }>();
  const { run } = task;
  const [draft, setDraft] = useState("");
  const [validation, setValidation] = useState<CredentialError>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const load = useCallback(() => run(async () => ({ fields: await secretFields() })), [secretFields, run]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const save = async () => {
    let credentials: Record<string, string>;
    try { credentials = parseCredentials(draft); }
    catch (error) { setValidation(error instanceof CredentialParseError ? error.code : "syntax"); return; }
    setValidation(undefined);
    const fields = Object.keys(credentials);
    const result = await task.run(async () => { await saveSecrets(credentials); return { fields, saved: true }; });
    if (result) setDraft("");
  };
  return <><h3>{t("tabs.setup")}</h3><p>{t("setupDescription")}</p><p className="neon-small">{t("setupHint")}</p>
    <label>{t("savedFields")}</label>{task.data && (task.data.fields.length ? <div className="neon-fields">{task.data.fields.map(name => <code key={name}>{name}</code>)}</div> : <div className="neon-empty">{t("noCredentials")}</div>)}
    <label htmlFor="neon-credentials">{t("importLabel")}</label><textarea id="neon-credentials" className="neon-secret" value={draft} disabled={task.pending} onChange={event => { setDraft(event.target.value); setValidation(undefined); }} autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={t("importPlaceholder")} />
    {validation && <div className="neon-feedback neon-error" role="alert">{t(`credentialErrors.${validation}`)}</div>}
    <div className="neon-row"><button className="neon-button neon-button-primary" disabled={!draft.trim() || task.pending} onClick={() => void save()}>{t("saveCredentials")}</button><button className="neon-button" disabled={!draft} onClick={() => { setDraft(""); setValidation(undefined); }}>{t("clearDraft")}</button><button className="neon-button neon-button-danger" disabled={task.pending || !task.data?.fields.length} onClick={() => setConfirmDelete(true)}>{t("deleteCredentials")}</button></div>
    {confirmDelete && <div className="neon-feedback"><p>{t("deleteCredentialsConfirm")}</p><div className="neon-row"><button className="neon-button neon-button-danger" disabled={task.pending} onClick={() => { setConfirmDelete(false); void task.run(async () => { await deleteSecrets(); return { fields: [], deleted: true }; }); }}>{t("confirm")}</button><button className="neon-button" onClick={() => setConfirmDelete(false)}>{t("cancel")}</button></div></div>}
    <Feedback {...task} />{task.data?.saved && <div className="neon-feedback neon-ok" role="status">{t("credentialsSaved")}</div>}{task.data?.deleted && <div className="neon-feedback" role="status">{t("credentialsDeleted")}</div>}
    <details><summary>{t("supportedFields")}</summary><p className="neon-small">{t("fieldsHint")}</p><div className="neon-fields">{credentialNames.map(name => <code key={name}>{name}</code>)}</div></details>
  </>;
}
