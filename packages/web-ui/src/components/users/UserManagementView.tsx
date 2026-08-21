import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useDatabase } from "../../hooks/useDatabase";
import { toErrorMessage } from "../../utils/errors";

interface DbUserInfo {
  user: string;
  host: string;
  locked: boolean;
}

/** The dialect's privilege keywords, supplied by the driver. */
interface DbPrivilegeCatalog {
  /** Privileges valid at the database scope (and also globally). */
  database: string[];
  /** Privileges valid only at the global scope. */
  global: string[];
  /** Privileges valid at the table scope. */
  table: string[];
}

/** One scope's parsed privileges. `database === null` is the global scope. */
interface DbUserGrantSet {
  database: string | null;
  table: string | null;
  privileges: string[];
}

const scopeKey = (s: Pick<DbUserGrantSet, "database" | "table">) =>
  `${s.database ?? "*"}\0${s.table ?? "*"}`;

interface Props {
  connectionId: string;
  isActive: boolean;
}

/**
 * One editable scope (global / database / table): checkboxes reflect the
 * account's current privileges; toggling builds a grant/revoke diff applied
 * on demand.
 */
function ScopeCard({
  scope,
  original,
  catalog,
  busy,
  onApply,
}: {
  scope: { database: string | null; table: string | null };
  original: string[];
  catalog: DbPrivilegeCatalog;
  busy: boolean;
  onApply: (
    scope: { database: string | null; table: string | null },
    toGrant: string[],
    toRevoke: string[],
  ) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  // The parent keys this card on scope + original privileges, so a refresh
  // after an apply remounts it with a fresh initial state — no sync effect.
  const [checked, setChecked] = useState<Set<string>>(new Set(original));

  const options =
    scope.database === null
      ? [...catalog.database, ...catalog.global]
      : scope.table === null
        ? catalog.database
        : catalog.table;

  const toGrant = [...checked].filter((p) => !original.includes(p));
  const toRevoke = original.filter((p) => !checked.has(p));
  const dirty = toGrant.length > 0 || toRevoke.length > 0;

  const title =
    scope.database === null
      ? t("userManagement.globalScope")
      : scope.table === null
        ? scope.database
        : `${scope.database}.${scope.table}`;

  return (
    <div className="rounded-lg border border-default bg-elevated p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        {scope.database === null ? (
          <Globe size={13} className="text-blue-400 shrink-0" />
        ) : (
          <Table2 size={13} className="text-muted shrink-0" />
        )}
        <span className="text-xs font-semibold text-primary truncate">
          {title}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <button
              onClick={() => setChecked(new Set(original))}
              className="text-[11px] text-muted hover:text-primary transition-colors"
            >
              {t("common.cancel")}
            </button>
          )}
          <button
            onClick={() => void onApply(scope, toGrant, toRevoke)}
            disabled={!dirty || busy}
            className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[11px] transition-colors"
          >
            {t("userManagement.apply")}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
        {options.map((p) => {
          const isChecked = checked.has(p);
          const changed = isChecked !== original.includes(p);
          return (
            <label
              key={p}
              className={clsx(
                "flex items-center gap-2 text-xs cursor-pointer select-none",
                changed
                  ? "text-amber-300"
                  : "text-secondary hover:text-primary",
              )}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() =>
                  setChecked((prev) => {
                    const next = new Set(prev);
                    if (next.has(p)) next.delete(p);
                    else next.add(p);
                    return next;
                  })
                }
              />
              {p}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Server account management tab (users & privileges). Shown for drivers with
 * the `user_management` capability. Lists accounts; per account, the parsed
 * grants render as one editable card per scope (global / database / table)
 * where checking grants and unchecking revokes. Grants the dialect cannot
 * model that way (roles, column-level) remain visible in the raw list.
 */
export function UserManagementView({ connectionId, isActive }: Props) {
  const { t } = useTranslation();
  const { selectedDatabases } = useDatabase();

  const [users, setUsers] = useState<DbUserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<DbUserInfo | null>(null);

  const [grants, setGrants] = useState<string[]>([]);
  const [grantSets, setGrantSets] = useState<DbUserGrantSet[]>([]);
  const [extraScopes, setExtraScopes] = useState<
    { database: string | null; table: string | null }[]
  >([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [catalog, setCatalog] = useState<DbPrivilegeCatalog>({
    database: [],
    global: [],
    table: [],
  });

  // Create-user form
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState("");
  const [newHost, setNewHost] = useState("%");
  const [newPassword, setNewPassword] = useState("");
  const [newScopeDb, setNewScopeDb] = useState("");
  const [newPrivs, setNewPrivs] = useState<Set<string>>(new Set());

  // Change-password form
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState("");

  // Add-scope form
  const [addingScope, setAddingScope] = useState(false);
  const [addDb, setAddDb] = useState("");
  const [addTable, setAddTable] = useState("");

  useEffect(() => {
    invoke<DbPrivilegeCatalog>("get_db_privilege_catalog", { connectionId })
      .then(setCatalog)
      .catch((e: unknown) => {
        console.error("Failed to load privilege catalog:", e);
      });
  }, [connectionId]);

  const refreshUsers = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return invoke<DbUserInfo[]>("get_db_users", { connectionId })
      .then(setUsers)
      .catch((e: unknown) => setLoadError(toErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [connectionId]);

  useEffect(() => {
    refreshUsers();
  }, [refreshUsers]);

  const refreshGrants = useCallback(
    (account: DbUserInfo) => {
      setGrantsLoading(true);
      setGrantsError(null);
      const target = {
        connectionId,
        user: account.user,
        host: account.host,
      };
      return Promise.all([
        invoke<string[]>("get_db_user_grants", target),
        invoke<DbUserGrantSet[]>("get_db_user_privileges", target),
      ])
        .then(([lines, sets]) => {
          setGrants(lines);
          setGrantSets(sets);
        })
        .catch((e: unknown) => setGrantsError(toErrorMessage(e)))
        .finally(() => setGrantsLoading(false));
    },
    [connectionId],
  );

  useEffect(() => {
    setExtraScopes([]);
    setAddingScope(false);
    if (selected) refreshGrants(selected);
    else {
      setGrants([]);
      setGrantSets([]);
    }
  }, [selected, refreshGrants]);

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.user}@${u.host}`.toLowerCase().includes(q));
  }, [users, filter]);

  // Cards to render: the global scope always, then every scope carrying
  // grants, then scopes added locally in this session.
  const scopeCards = useMemo(() => {
    const cards: {
      scope: { database: string | null; table: string | null };
      original: string[];
    }[] = [{ scope: { database: null, table: null }, original: [] }];
    for (const s of grantSets) {
      const existing = cards.find((c) => scopeKey(c.scope) === scopeKey(s));
      if (existing) existing.original = s.privileges;
      else
        cards.push({
          scope: { database: s.database, table: s.table },
          original: s.privileges,
        });
    }
    for (const s of extraScopes) {
      if (!cards.some((c) => scopeKey(c.scope) === scopeKey(s))) {
        cards.push({ scope: s, original: [] });
      }
    }
    return cards;
  }, [grantSets, extraScopes]);

  const runAction = async (action: () => Promise<void>): Promise<boolean> => {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      return true;
    } catch (e) {
      setActionError(toErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () =>
    runAction(async () => {
      const user = newUser.trim();
      const host = newHost.trim() || "%";
      await invoke("create_db_user", {
        connectionId,
        user,
        host,
        password: newPassword,
      });
      // Initial privileges, scoped to the chosen database (or globally
      // when the field is left empty on purpose).
      if (newPrivs.size > 0) {
        await invoke("apply_db_user_privileges", {
          connectionId,
          user,
          host,
          database: newScopeDb.trim() || null,
          table: null,
          privileges: [...newPrivs],
          grant: true,
        });
      }
      setCreating(false);
      setNewUser("");
      setNewHost("%");
      setNewPassword("");
      setNewScopeDb("");
      setNewPrivs(new Set());
      await refreshUsers();
      setSelected({ user, host, locked: false });
    });

  const handleDrop = async (account: DbUserInfo) => {
    const ok = await confirm(
      t("userManagement.dropConfirm", {
        account: `${account.user}@${account.host}`,
      }),
      { title: t("userManagement.dropTitle"), kind: "warning" },
    );
    if (!ok) return;
    await runAction(async () => {
      await invoke("drop_db_user", {
        connectionId,
        user: account.user,
        host: account.host,
      });
      if (selected?.user === account.user && selected?.host === account.host) {
        setSelected(null);
      }
      await refreshUsers();
    });
  };

  const handleChangePassword = () =>
    runAction(async () => {
      if (!selected) return;
      await invoke("set_db_user_password", {
        connectionId,
        user: selected.user,
        host: selected.host,
        password,
      });
      setChangingPassword(false);
      setPassword("");
    });

  const handleApplyScope = async (
    scope: { database: string | null; table: string | null },
    toGrant: string[],
    toRevoke: string[],
  ): Promise<boolean> => {
    if (!selected) return false;
    if (toRevoke.length > 0) {
      const ok = await confirm(
        t("userManagement.revokeConfirm", {
          account: `${selected.user}@${selected.host}`,
          privileges: toRevoke.join(", "),
          scope:
            scope.database === null
              ? "*.*"
              : scope.table === null
                ? `${scope.database}.*`
                : `${scope.database}.${scope.table}`,
        }),
        { title: t("userManagement.revokeTitle"), kind: "warning" },
      );
      if (!ok) return false;
    }
    return runAction(async () => {
      const base = {
        connectionId,
        user: selected.user,
        host: selected.host,
        database: scope.database,
        table: scope.table,
      };
      // Revoke first: switching away from ALL PRIVILEGES is expressed as
      // "revoke ALL, grant the subset", which only works in this order.
      if (toRevoke.length > 0) {
        await invoke("apply_db_user_privileges", {
          ...base,
          privileges: toRevoke,
          grant: false,
        });
      }
      if (toGrant.length > 0) {
        await invoke("apply_db_user_privileges", {
          ...base,
          privileges: toGrant,
          grant: true,
        });
      }
      await refreshGrants(selected);
    });
  };

  if (!isActive) return null;

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-base">
      {/* Left: account list */}
      <div className="w-72 shrink-0 border-r border-default flex flex-col min-h-0">
        <div className="flex items-center gap-2 p-2 border-b border-default">
          <div className="relative flex-1">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
            />
            <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("userManagement.filterPlaceholder")}
              spellCheck={false}
              className="w-full pl-7 pr-2 py-1.5 bg-elevated border border-strong rounded-md text-xs text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => refreshUsers()}
            title={t("common.refresh")}
            className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-surface-secondary transition-colors"
          >
            <RefreshCw size={13} className={clsx(loading && "animate-spin")} />
          </button>
          <button
            onClick={() => {
              setCreating(true);
              setActionError(null);
            }}
            title={t("userManagement.newUser")}
            className="p-1.5 rounded-md text-blue-400 hover:text-blue-300 hover:bg-surface-secondary transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {loadError && (
            <p className="text-xs text-red-400 px-3 py-2 break-words">
              {t("userManagement.loadError")} {loadError}
            </p>
          )}
          {!loadError && !loading && filteredUsers.length === 0 && (
            <p className="text-xs text-muted px-3 py-2">
              {t("userManagement.noUsers")}
            </p>
          )}
          {filteredUsers.map((u) => {
            const isSel =
              selected?.user === u.user && selected?.host === u.host;
            return (
              <button
                key={`${u.user}@${u.host}`}
                onClick={() => {
                  setSelected(u);
                  setActionError(null);
                  setChangingPassword(false);
                }}
                className={clsx(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                  isSel
                    ? "bg-blue-500/15 text-primary"
                    : "text-secondary hover:bg-surface-secondary",
                )}
              >
                <UserRound size={13} className="text-muted shrink-0" />
                <span className="text-xs truncate flex-1">
                  {u.user}
                  <span className="text-muted">@{u.host}</span>
                </span>
                {u.locked && (
                  <Lock
                    size={11}
                    className="text-amber-400 shrink-0"
                    aria-label={t("userManagement.locked")}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: details */}
      <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-5">
        {creating && (
          <div className="max-w-2xl p-3 rounded-lg border border-strong bg-elevated space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary">
                {t("userManagement.newUser")}
              </h3>
              <button
                onClick={() => setCreating(false)}
                aria-label={t("common.cancel")}
                className="p-1 rounded-md text-muted hover:text-primary transition-colors"
              >
                <X size={13} />
              </button>
            </div>
            <div className="flex items-center gap-2 max-w-md">
              <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
                type="text"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
                placeholder={t("userManagement.userPlaceholder")}
                autoFocus
                spellCheck={false}
                className="flex-1 px-2 py-1.5 bg-base border border-strong rounded-md text-xs text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
              <span className="text-muted text-xs">@</span>
              <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
                type="text"
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
                placeholder="%"
                spellCheck={false}
                className="w-28 px-2 py-1.5 bg-base border border-strong rounded-md text-xs text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
            </div>
            <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("userManagement.passwordPlaceholder")}
              className="w-full max-w-md px-2 py-1.5 bg-base border border-strong rounded-md text-xs text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />

            {/* Initial privileges (optional) */}
            <div className="space-y-2 pt-1 border-t border-default/60">
              <p className="text-[11px] text-muted">
                {t("userManagement.initialPrivilegesHint")}
              </p>
              <div className="flex items-center gap-2 max-w-md">
                <label className="text-xs text-muted shrink-0">
                  {t("userManagement.scope")}
                </label>
                <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
                  type="text"
                  value={newScopeDb}
                  onChange={(e) => {
                    setNewScopeDb(e.target.value);
                    if (e.target.value.trim() !== "") {
                      setNewPrivs(
                        (prev) =>
                          new Set(
                            [...prev].filter((p) =>
                              catalog.database.includes(p),
                            ),
                          ),
                      );
                    }
                  }}
                  list="user-mgmt-databases"
                  placeholder={t("userManagement.scopePlaceholder")}
                  spellCheck={false}
                  className="flex-1 px-2 py-1.5 bg-base border border-strong rounded-md text-xs text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                {(newScopeDb.trim() === ""
                  ? [...catalog.database, ...catalog.global]
                  : catalog.database
                ).map((p) => (
                  <label
                    key={p}
                    className="flex items-center gap-2 text-xs text-secondary cursor-pointer select-none hover:text-primary"
                  >
                    <input
                      type="checkbox"
                      checked={newPrivs.has(p)}
                      onChange={() =>
                        setNewPrivs((prev) => {
                          const next = new Set(prev);
                          if (next.has(p)) next.delete(p);
                          else next.add(p);
                          return next;
                        })
                      }
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void handleCreate()}
                disabled={busy || !newUser.trim()}
                className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs transition-colors"
              >
                {t("userManagement.create")}
              </button>
            </div>
          </div>
        )}

        {!selected && !creating && (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-muted">
              {t("userManagement.selectPrompt")}
            </p>
          </div>
        )}

        {selected && (
          <>
            {/* Header + account actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-base font-semibold text-primary">
                {selected.user}
                <span className="text-muted">@{selected.host}</span>
              </h2>
              {selected.locked && (
                <span className="flex items-center gap-1 text-[11px] text-amber-400">
                  <Lock size={11} /> {t("userManagement.locked")}
                </span>
              )}
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => {
                    setChangingPassword((v) => !v);
                    setPassword("");
                    setActionError(null);
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-secondary hover:text-primary hover:bg-surface-secondary border border-default transition-colors"
                >
                  <KeyRound size={12} />
                  {t("userManagement.changePassword")}
                </button>
                <button
                  onClick={() => void handleDrop(selected)}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 border border-default transition-colors disabled:opacity-50"
                >
                  <Trash2 size={12} />
                  {t("userManagement.dropUser")}
                </button>
              </div>
            </div>

            {changingPassword && (
              <div className="max-w-md flex items-center gap-2">
                <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("userManagement.newPasswordPlaceholder")}
                  autoFocus
                  className="flex-1 px-2 py-1.5 bg-elevated border border-strong rounded-md text-xs text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={() => void handleChangePassword()}
                  disabled={busy || password.length === 0}
                  className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs transition-colors"
                >
                  {t("common.save")}
                </button>
              </div>
            )}

            {/* Privilege editor: one card per scope */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide">
                  {t("userManagement.privileges")}
                </h3>
                {busy && (
                  <Loader2 size={13} className="animate-spin text-muted" />
                )}
                <button
                  onClick={() => setAddingScope((v) => !v)}
                  className="ml-auto flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Plus size={11} />
                  {t("userManagement.addScope")}
                </button>
              </div>

              {addingScope && (
                <div className="flex items-center gap-2 flex-wrap max-w-xl p-2 rounded-lg border border-strong bg-elevated">
                  <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
                    type="text"
                    value={addDb}
                    onChange={(e) => setAddDb(e.target.value)}
                    list="user-mgmt-databases"
                    placeholder={t("userManagement.databasePlaceholder")}
                    autoFocus
                    spellCheck={false}
                    className="w-44 px-2 py-1.5 bg-base border border-strong rounded-md text-xs text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
                  />
                  <span className="text-muted text-xs">.</span>
                  <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
                    type="text"
                    value={addTable}
                    onChange={(e) => setAddTable(e.target.value)}
                    placeholder={t("userManagement.tablePlaceholder")}
                    spellCheck={false}
                    className="w-44 px-2 py-1.5 bg-base border border-strong rounded-md text-xs text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      if (!addDb.trim()) return;
                      setExtraScopes((prev) => [
                        ...prev,
                        {
                          database: addDb.trim(),
                          table: addTable.trim() || null,
                        },
                      ]);
                      setAddDb("");
                      setAddTable("");
                      setAddingScope(false);
                    }}
                    disabled={!addDb.trim()}
                    className="px-2.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs transition-colors"
                  >
                    {t("userManagement.add")}
                  </button>
                </div>
              )}

              {grantsLoading ? (
                <Loader2 size={16} className="animate-spin text-muted" />
              ) : grantsError ? (
                <p className="text-xs text-red-400 break-words">
                  {grantsError}
                </p>
              ) : (
                scopeCards.map(({ scope, original }) => (
                  <ScopeCard
                    key={`${scopeKey(scope)}|${original.join(",")}`}
                    scope={scope}
                    original={original}
                    catalog={catalog}
                    busy={busy}
                    onApply={handleApplyScope}
                  />
                ))
              )}
            </section>

            {/* Raw grants: complete server output, covers grants the editor
                cannot model (roles, column-level, proxy). */}
            {!grantsLoading && !grantsError && grants.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide">
                  {t("userManagement.currentGrants")}
                </h3>
                <div className="rounded-lg border border-default bg-elevated overflow-x-auto">
                  {grants.map((g, i) => (
                    <pre
                      key={i}
                      className="px-3 py-1.5 text-[11px] text-secondary font-mono whitespace-pre border-b border-default/50 last:border-b-0"
                    >
                      {g}
                    </pre>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <datalist id="user-mgmt-databases">
          {selectedDatabases.map((db) => (
            <option key={db} value={db} />
          ))}
        </datalist>

        {actionError && (
          <p className="text-xs text-red-400 break-words">{actionError}</p>
        )}
      </div>
    </div>
  );
}
