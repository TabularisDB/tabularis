import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Loader2,
  Database,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  FolderPlus,
  FlaskConical,
  ListChecks,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { toErrorMessage } from "../../utils/errors";
import { useDatabase } from "../../hooks/useDatabase";
import type { ConnectionGroup } from "../../contexts/DatabaseContext";
import { flattenGroupTree } from "../../utils/groupTree";
import { Select } from "../ui/Select";
import { PasswordInput } from "../ui/PasswordInput";
import { BetaBadge } from "../ui/BetaBadge";
import { GITHUB_ISSUES_URL } from "../../config/links";
import type {
  ImportSourceInfo,
  ImportPreview,
  ImportItem,
  ImportResolution,
  ImportAction,
} from "../../types/connectionImport";

interface ImportFromAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful import so the caller can reload connections. */
  onImported: () => void;
}

type Step = "picker" | "preview" | "password";

/** Synthetic source: import from a Tabularis JSON export file (handled
 * directly, without the foreign-app preview pipeline). */
const TABULARIS_SOURCE_ID = "tabularis-json";

/** Sentinel `groupChoice` values that aren't a real group id. */
const GROUP_NONE = "__none__";
const GROUP_NEW = "__new__";
/** Bulk-only sentinel: leave each connection's own group choice untouched. */
const GROUP_KEEP = "__keep__";
/** Bulk-only sentinel: leave each connection's own action untouched. */
const ACTION_KEEP = "__keep__";

export const ImportFromAppModal = ({
  isOpen,
  onClose,
  onImported,
}: ImportFromAppModalProps) => {
  const { t } = useTranslation();
  const { connectionGroups } = useDatabase();

  const [step, setStep] = useState<Step>("picker");
  const [sources, setSources] = useState<ImportSourceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includePasswords, setIncludePasswords] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [resolutions, setResolutions] = useState<Record<number, ImportAction>>({});
  // Per-item group selection for new imports: a group id, GROUP_NONE, or GROUP_NEW.
  const [groupChoice, setGroupChoice] = useState<Record<number, string>>({});
  const [newGroupName, setNewGroupName] = useState<Record<number, string>>({});
  // Parent group id for a "new group" choice; GROUP_NONE means top level.
  const [newGroupParent, setNewGroupParent] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Encrypted Tabularis export: the parsed envelope awaiting a password.
  const [pendingEnvelope, setPendingEnvelope] = useState<unknown>(null);
  const [password, setPassword] = useState("");
  // Parsed (and decrypted) Tabularis payload backing the preview, so `apply`
  // can re-send it without re-reading the file.
  const [tabularisPayload, setTabularisPayload] = useState<unknown>(null);
  // Bulk actions shown above the preview list.
  const [bulkAction, setBulkAction] = useState<string>(ACTION_KEEP);
  const [bulkGroup, setBulkGroup] = useState<string>(GROUP_KEEP);
  const [bulkNewName, setBulkNewName] = useState("");
  const [bulkNewParent, setBulkNewParent] = useState<string>(GROUP_NONE);

  const reset = useCallback(() => {
    setStep("picker");
    setSelectedId(null);
    setIncludePasswords(true);
    setPreview(null);
    setResolutions({});
    setGroupChoice({});
    setNewGroupName({});
    setError(null);
    setLoading(false);
    setPendingEnvelope(null);
    setPassword("");
    setTabularisPayload(null);
    setBulkAction(ACTION_KEEP);
    setBulkGroup(GROUP_KEEP);
    setBulkNewName("");
    setBulkNewParent(GROUP_NONE);
  }, []);

  // Load the source list whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    reset();
    setLoading(true);
    const tabularisSource: ImportSourceInfo = {
      id: TABULARIS_SOURCE_ID,
      displayName: "Tabularis",
      available: true,
      connectionCount: 0,
      readsPasswordsFromKeychain: false,
      needsFile: true,
    };
    invoke<ImportSourceInfo[]>("list_connection_import_sources")
      .then((list) => {
        const all = [tabularisSource, ...list];
        setSources(all);
        const firstAvailable = all.find((s) => s.available);
        setSelectedId(firstAvailable?.id ?? null);
      })
      .catch((e) => setError(toErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [isOpen, reset]);

  const selectedSource = sources.find((s) => s.id === selectedId) ?? null;

  // Seed the preview step from a returned ImportPreview: import everything,
  // skip duplicates, and default each item's group to its source folder
  // (reusing a matching existing group, otherwise pre-filling a new-group name).
  const showPreview = (result: ImportPreview) => {
    const defaults: Record<number, ImportAction> = {};
    const groupDefaults: Record<number, string> = {};
    const newNameDefaults: Record<number, string> = {};
    for (const item of result.items) {
      defaults[item.index] = item.status.kind === "duplicate" ? "skip" : "import";
      if (item.groupName) {
        const match = connectionGroups.find(
          (g) => g.name.trim().toLowerCase() === item.groupName!.trim().toLowerCase(),
        );
        if (match) {
          groupDefaults[item.index] = match.id;
        } else {
          groupDefaults[item.index] = GROUP_NEW;
          newNameDefaults[item.index] = item.groupName;
        }
      } else {
        groupDefaults[item.index] = GROUP_NONE;
      }
    }
    setPreview(result);
    setResolutions(defaults);
    setGroupChoice(groupDefaults);
    setNewGroupName(newNameDefaults);
    setBulkAction(ACTION_KEEP);
    setBulkGroup(GROUP_KEEP);
    setBulkNewName("");
    setBulkNewParent(GROUP_NONE);
    setStep("preview");
  };

  // Preview a parsed Tabularis payload (plain or already decrypted) so it goes
  // through the same per-item group picker as a foreign-app import.
  const previewTabularis = async (payload: unknown) => {
    const result = await invoke<ImportPreview>("preview_tabularis_import", {
      payload,
    });
    setTabularisPayload(payload);
    showPreview(result);
  };

  const handleContinue = async () => {
    if (!selectedSource || !selectedSource.available) return;
    setError(null);
    setLoading(true);
    try {
      // Tabularis export file: parse (decrypt if needed), then preview.
      if (selectedSource.id === TABULARIS_SOURCE_ID) {
        const picked = await open({
          filters: [{ name: "JSON", extensions: ["json"] }],
          multiple: false,
        });
        if (!picked || Array.isArray(picked)) {
          setLoading(false);
          return;
        }
        const content = await readTextFile(picked);
        const payload = JSON.parse(content) as { encrypted?: boolean };
        // Encrypted exports are an opaque envelope: prompt for the password
        // and decrypt before previewing.
        if (payload && payload.encrypted === true) {
          setPendingEnvelope(payload);
          setPassword("");
          setError(null);
          setStep("password");
          setLoading(false);
          return;
        }
        await previewTabularis(payload);
        return;
      }

      let filePath: string | null = null;
      if (selectedSource.needsFile) {
        const picked = await open({ multiple: false });
        if (!picked || Array.isArray(picked)) {
          setLoading(false);
          return;
        }
        filePath = picked;
      }
      const result = await invoke<ImportPreview>("preview_connection_import", {
        sourceId: selectedSource.id,
        includePasswords,
        filePath,
      });
      showPreview(result);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDecryptImport = async () => {
    if (!pendingEnvelope || !password) return;
    setError(null);
    setLoading(true);
    try {
      const payload = await invoke("decrypt_export_payload", {
        envelope: pendingEnvelope,
        password,
      });
      await previewTabularis(payload);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!preview || !selectedSource) return;
    setError(null);
    setLoading(true);
    try {
      const payload: ImportResolution[] = preview.items.map((item) => {
        const action = resolutions[item.index] ?? "skip";
        if (action === "replace" && item.status.kind === "duplicate") {
          return { index: item.index, action, replaceExistingId: item.status.existingId };
        }
        if (action === "import") {
          const choice = groupChoice[item.index] ?? GROUP_NONE;
          if (choice === GROUP_NEW) {
            const name = newGroupName[item.index]?.trim();
            // An empty new-group name means "no group".
            if (!name) {
              return { index: item.index, action, groupId: "" };
            }
            const parent = newGroupParent[item.index];
            return {
              index: item.index,
              action,
              newGroupName: name,
              ...(parent && parent !== GROUP_NONE
                ? { newGroupParentId: parent }
                : {}),
            };
          }
          // GROUP_NONE clears the group; any other value is an existing group id.
          return {
            index: item.index,
            action,
            groupId: choice === GROUP_NONE ? "" : choice,
          };
        }
        return { index: item.index, action };
      });
      if (selectedSource.id === TABULARIS_SOURCE_ID) {
        await invoke("apply_tabularis_import", {
          payload: tabularisPayload,
          resolutions: payload,
        });
      } else {
        await invoke("apply_connection_import", {
          sourceId: selectedSource.id,
          resolutions: payload,
        });
      }
      onImported();
      onClose();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // Bulk "action for all": import or skip every listed connection at once.
  // ACTION_KEEP leaves each item's own choice intact.
  const applyBulkAction = (action: string) => {
    setBulkAction(action);
    if (action === ACTION_KEEP || !preview) return;
    const next: Record<number, ImportAction> = {};
    preview.items.forEach((i) => {
      next[i.index] = action as ImportAction;
    });
    setResolutions(next);
  };

  // Bulk "destination group for all": writes the chosen group to every item's
  // per-connection resolution. GROUP_KEEP leaves each item's own choice intact.
  const applyBulkGroup = (choice: string) => {
    setBulkGroup(choice);
    if (choice === GROUP_KEEP || !preview) return;
    const next: Record<number, string> = {};
    preview.items.forEach((i) => {
      next[i.index] = choice;
    });
    setGroupChoice(next);
    if (choice === GROUP_NEW) {
      const names: Record<number, string> = {};
      const parents: Record<number, string> = {};
      preview.items.forEach((i) => {
        names[i.index] = bulkNewName;
        parents[i.index] = bulkNewParent;
      });
      setNewGroupName(names);
      setNewGroupParent(parents);
    }
  };

  const applyBulkNewName = (name: string) => {
    setBulkNewName(name);
    if (!preview) return;
    const next: Record<number, string> = {};
    preview.items.forEach((i) => {
      next[i.index] = name;
    });
    setNewGroupName(next);
  };

  const applyBulkNewParent = (parent: string) => {
    setBulkNewParent(parent);
    if (!preview) return;
    const next: Record<number, string> = {};
    preview.items.forEach((i) => {
      next[i.index] = parent;
    });
    setNewGroupParent(next);
  };

  if (!isOpen) return null;

  const importCount = preview
    ? preview.items.filter((i) => (resolutions[i.index] ?? "skip") !== "skip").length
    : 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[640px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            {(step === "preview" || step === "password") && (
              <button
                onClick={() => setStep("picker")}
                className="text-secondary hover:text-primary transition-colors"
                title={t("common.back", { defaultValue: "Back" })}
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <Database size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-primary">
                {t("connections.importFromApp.title")}
                <BetaBadge />
              </h2>
              <p className="text-xs text-secondary">
                {step === "picker"
                  ? t("connections.importFromApp.subtitle")
                  : step === "password"
                    ? t("connections.importPasswordModal.subtitle")
                    : t("connections.importFromApp.previewSubtitle", {
                        source: preview?.sourceName ?? "",
                      })}
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
        <div className="p-6 overflow-y-auto flex-1">
          {/* Beta notice with a link to report problems. */}
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300/90">
            <FlaskConical size={14} className="mt-0.5 shrink-0" />
            <span>
              {t("connections.importFromApp.betaNotice")}{" "}
              <button
                onClick={() => openUrl(GITHUB_ISSUES_URL)}
                className="font-medium underline underline-offset-2 hover:text-amber-200"
              >
                {t("connections.importFromApp.reportIssue")}
              </button>
            </span>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-10 text-muted">
              <Loader2 size={22} className="animate-spin" />
            </div>
          )}

          {!loading && step === "picker" && (
            <SourcePicker
              sources={sources}
              selectedId={selectedId}
              onSelect={setSelectedId}
              includePasswords={includePasswords}
              onTogglePasswords={setIncludePasswords}
            />
          )}

          {!loading && step === "preview" && preview && (
            <div className="space-y-3">
              {preview.items.length > 0 && (
                <BulkGroupSelector
                  groups={connectionGroups}
                  action={bulkAction}
                  onActionChange={applyBulkAction}
                  showGroup={importCount > 0}
                  value={bulkGroup}
                  newGroupName={bulkNewName}
                  newGroupParent={bulkNewParent}
                  onChange={applyBulkGroup}
                  onNewGroupNameChange={applyBulkNewName}
                  onNewGroupParentChange={applyBulkNewParent}
                />
              )}
              <PreviewList
                preview={preview}
                resolutions={resolutions}
                onChange={(index, action) =>
                  setResolutions((prev) => ({ ...prev, [index]: action }))
                }
                groups={connectionGroups}
                groupChoice={groupChoice}
                newGroupName={newGroupName}
                newGroupParent={newGroupParent}
                onGroupChoiceChange={(index, value) =>
                  setGroupChoice((prev) => ({ ...prev, [index]: value }))
                }
                onNewGroupNameChange={(index, value) =>
                  setNewGroupName((prev) => ({ ...prev, [index]: value }))
                }
                onNewGroupParentChange={(index, value) =>
                  setNewGroupParent((prev) => ({ ...prev, [index]: value }))
                }
              />
            </div>
          )}

          {!loading && step === "password" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-secondary">
                <Lock size={15} className="text-blue-400 shrink-0" />
                <span>{t("connections.importPasswordModal.title")}</span>
              </div>
              <label className="block text-xs font-medium text-secondary">
                {t("connections.importPasswordModal.password")}
              </label>
              <PasswordInput
                value={password}
                onChange={setPassword}
                autoFocus
                aria-label={t("connections.importPasswordModal.password")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && password) void handleDecryptImport();
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-between gap-3">
          {step === "preview" && preview?.credentialsAborted ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-400">
              <AlertTriangle size={13} />
              {t("connections.importFromApp.credentialsAborted")}
            </span>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
            {step === "picker" ? (
              <button
                onClick={handleContinue}
                disabled={!selectedSource?.available || loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t("common.continue", { defaultValue: "Continue" })}
              </button>
            ) : step === "password" ? (
              <button
                onClick={handleDecryptImport}
                disabled={loading || !password}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t("connections.importPasswordModal.unlock")}
              </button>
            ) : (
              <button
                onClick={handleApply}
                disabled={loading || importCount === 0}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t("connections.importFromApp.importCount", { count: importCount })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Source picker step ─────────────────────────────────────────────────────

interface SourcePickerProps {
  sources: ImportSourceInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  includePasswords: boolean;
  onTogglePasswords: (value: boolean) => void;
}

const SourcePicker = ({
  sources,
  selectedId,
  onSelect,
  includePasswords,
  onTogglePasswords,
}: SourcePickerProps) => {
  const { t } = useTranslation();

  const subtitle = (s: ImportSourceInfo) => {
    if (s.id === TABULARIS_SOURCE_ID) return t("connections.importFromApp.tabularisJsonHint");
    if (!s.available) return t("connections.importFromApp.notInstalled");
    if (s.needsFile) return t("connections.importFromApp.chooseFile");
    return t("connections.importFromApp.connectionsFound", { count: s.connectionCount });
  };

  const showPasswordToggle = selectedId !== TABULARIS_SOURCE_ID;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        {sources.map((s) => {
          const selected = s.id === selectedId;
          return (
            <button
              key={s.id}
              disabled={!s.available}
              onClick={() => onSelect(s.id)}
              className={clsx(
                "w-full flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all",
                selected
                  ? "border-blue-500/60 bg-blue-500/10"
                  : "border-strong bg-base hover:border-blue-400/40",
                !s.available && "opacity-50 cursor-not-allowed hover:border-strong",
              )}
            >
              <div className="p-2 rounded-lg bg-surface-secondary">
                <Database size={18} className="text-secondary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary">{s.displayName}</p>
                <p className="text-xs text-muted">{subtitle(s)}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Include passwords toggle */}
      {showPasswordToggle && (
      <label className="flex items-start gap-3 rounded-xl border border-strong bg-base p-3.5 cursor-pointer">
        <input
          type="checkbox"
          checked={includePasswords}
          onChange={(e) => onTogglePasswords(e.target.checked)}
          className="mt-0.5 accent-blue-500"
        />
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <KeyRound size={13} />
            {t("connections.importFromApp.includePasswords")}
          </p>
          <p className="text-xs text-muted">
            {t("connections.importFromApp.includePasswordsHint")}
          </p>
        </div>
      </label>
      )}
    </div>
  );
};

// ── Bulk group selector ─────────────────────────────────────────────────────

interface BulkGroupSelectorProps {
  groups: ConnectionGroup[];
  action: string;
  onActionChange: (value: string) => void;
  showGroup: boolean;
  value: string;
  newGroupName: string;
  newGroupParent: string;
  onChange: (value: string) => void;
  onNewGroupNameChange: (value: string) => void;
  onNewGroupParentChange: (value: string) => void;
}

/** Bulk controls applied to every listed connection at once: an action
 * (import / skip all) and a single destination group. */
const BulkGroupSelector = ({
  groups,
  action,
  onActionChange,
  showGroup,
  value,
  newGroupName,
  newGroupParent,
  onChange,
  onNewGroupNameChange,
  onNewGroupParentChange,
}: BulkGroupSelectorProps) => {
  const { t } = useTranslation();
  const groupTree = flattenGroupTree(groups);

  return (
    <div className="space-y-2 rounded-xl border border-blue-500/30 bg-blue-500/5 px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-secondary">
          <ListChecks size={13} className="text-blue-400" />
          {t("connections.importFromApp.action.applyToAll")}
        </label>
        <Select
          value={action}
          options={[ACTION_KEEP, "import", "skip"]}
          labels={{
            [ACTION_KEEP]: t("connections.importFromApp.group.keepPerConnection"),
            import: t("connections.importFromApp.action.import"),
            skip: t("connections.importFromApp.action.skip"),
          }}
          onChange={onActionChange}
          searchable={false}
          className="min-w-0 flex-1"
        />
      </div>
      {showGroup && (
        <>
          <div className="flex items-center gap-2">
            <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-secondary">
              <FolderPlus size={13} className="text-blue-400" />
              {t("connections.importFromApp.group.applyToAll")}
            </label>
            <Select
              value={value}
              options={[GROUP_KEEP, GROUP_NONE, ...groupTree.map((e) => e.group.id), GROUP_NEW]}
              labels={{
                [GROUP_KEEP]: t("connections.importFromApp.group.keepPerConnection"),
                [GROUP_NONE]: t("connections.importFromApp.group.none"),
                [GROUP_NEW]: t("connections.importFromApp.group.new"),
                ...Object.fromEntries(groupTree.map((e) => [e.group.id, e.group.name])),
              }}
              indents={Object.fromEntries(groupTree.map((e) => [e.group.id, e.depth]))}
              onChange={onChange}
              searchable={groups.length > 6}
              className="min-w-0 flex-1"
            />
          </div>
          {value === GROUP_NEW && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={newGroupName}
                autoFocus
                onChange={(e) => onNewGroupNameChange(e.target.value)}
                placeholder={t("connections.importFromApp.group.newPlaceholder")}
                className="min-w-0 flex-1 rounded border border-strong bg-base px-3 py-2 text-sm text-primary focus:border-blue-500 focus:outline-none"
              />
              <label className="shrink-0 text-xs text-muted">
                {t("connections.importFromApp.group.parentLabel")}
              </label>
              <Select
                value={newGroupParent}
                options={[GROUP_NONE, ...groupTree.map((e) => e.group.id)]}
                labels={{
                  [GROUP_NONE]: t("connections.importFromApp.group.parentNone"),
                  ...Object.fromEntries(groupTree.map((e) => [e.group.id, e.group.name])),
                }}
                indents={Object.fromEntries(groupTree.map((e) => [e.group.id, e.depth]))}
                onChange={onNewGroupParentChange}
                searchable={groups.length > 6}
                className="min-w-0 flex-1"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── Preview step ───────────────────────────────────────────────────────────

interface PreviewListProps {
  preview: ImportPreview;
  resolutions: Record<number, ImportAction>;
  onChange: (index: number, action: ImportAction) => void;
  groups: ConnectionGroup[];
  groupChoice: Record<number, string>;
  newGroupName: Record<number, string>;
  newGroupParent: Record<number, string>;
  onGroupChoiceChange: (index: number, value: string) => void;
  onNewGroupNameChange: (index: number, value: string) => void;
  onNewGroupParentChange: (index: number, value: string) => void;
}

const PreviewList = ({
  preview,
  resolutions,
  onChange,
  groups,
  groupChoice,
  newGroupName,
  newGroupParent,
  onGroupChoiceChange,
  onNewGroupNameChange,
  onNewGroupParentChange,
}: PreviewListProps) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      {preview.items.map((item) => (
        <PreviewRow
          key={item.index}
          item={item}
          action={resolutions[item.index] ?? "skip"}
          onChange={(action) => onChange(item.index, action)}
          groups={groups}
          groupChoice={groupChoice[item.index] ?? GROUP_NONE}
          newGroupName={newGroupName[item.index] ?? ""}
          newGroupParent={newGroupParent[item.index] ?? GROUP_NONE}
          onGroupChoiceChange={(value) => onGroupChoiceChange(item.index, value)}
          onNewGroupNameChange={(value) => onNewGroupNameChange(item.index, value)}
          onNewGroupParentChange={(value) => onNewGroupParentChange(item.index, value)}
        />
      ))}
      {preview.items.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">
          {t("connections.importFromApp.noConnections")}
        </p>
      )}
    </div>
  );
};

interface PreviewRowProps {
  item: ImportItem;
  action: ImportAction;
  onChange: (action: ImportAction) => void;
  groups: ConnectionGroup[];
  groupChoice: string;
  newGroupName: string;
  newGroupParent: string;
  onGroupChoiceChange: (value: string) => void;
  onNewGroupNameChange: (value: string) => void;
  onNewGroupParentChange: (value: string) => void;
}

const PreviewRow = ({
  item,
  action,
  onChange,
  groups,
  groupChoice,
  newGroupName,
  newGroupParent,
  onGroupChoiceChange,
  onNewGroupNameChange,
  onNewGroupParentChange,
}: PreviewRowProps) => {
  const { t } = useTranslation();
  const isDuplicate = item.status.kind === "duplicate";
  const groupTree = flattenGroupTree(groups);

  return (
    <div className="rounded-xl border border-strong bg-base px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <StatusBadge item={item} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-primary">
            {item.name}
            {item.hasPassword && (
              <Lock size={11} className="ml-1.5 inline text-green-400" />
            )}
          </p>
          <p className="truncate text-xs text-muted">
            {item.driverId}
            {" · "}
            {item.port ? `${item.host}:${item.port}` : item.host}
            {item.database ? ` / ${item.database}` : ""}
            {item.groupName ? `  ·  ${item.groupName}` : ""}
          </p>
          {item.status.kind === "warnings" && (
            <p className="mt-0.5 text-xs text-amber-400">
              {item.status.warnings.join(" · ")}
            </p>
          )}
          {isDuplicate && item.status.kind === "duplicate" && (
            <p className="mt-0.5 text-xs text-blue-300">
              {t("connections.importFromApp.duplicateOf", {
                name: item.status.existingName,
              })}
            </p>
          )}
        </div>

        {/* Per-item action selector */}
        <Select
          value={action}
          options={isDuplicate ? ["import", "skip", "replace"] : ["import", "skip"]}
          labels={{
            import: t("connections.importFromApp.action.import"),
            skip: t("connections.importFromApp.action.skip"),
            replace: t("connections.importFromApp.action.replace"),
          }}
          onChange={(value) => onChange(value as ImportAction)}
          searchable={false}
          className="w-32 shrink-0"
        />
      </div>

      {/* Group assignment — only for connections being imported as new. */}
      {action === "import" && (
        <div className="mt-2 flex items-center gap-2 pl-9">
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <FolderPlus size={13} />
            {t("connections.importFromApp.group.label")}
          </label>
          <Select
            value={groupChoice}
            options={[GROUP_NONE, ...groupTree.map((e) => e.group.id), GROUP_NEW]}
            labels={{
              [GROUP_NONE]: t("connections.importFromApp.group.none"),
              [GROUP_NEW]: t("connections.importFromApp.group.new"),
              ...Object.fromEntries(groupTree.map((e) => [e.group.id, e.group.name])),
            }}
            indents={Object.fromEntries(
              groupTree.map((e) => [e.group.id, e.depth]),
            )}
            onChange={onGroupChoiceChange}
            searchable={groups.length > 6}
            className="min-w-0 flex-1"
          />
          {groupChoice === GROUP_NEW && (
            <>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => onNewGroupNameChange(e.target.value)}
                placeholder={t("connections.importFromApp.group.newPlaceholder")}
                className="min-w-0 flex-1 rounded border border-strong bg-base px-3 py-2 text-sm text-primary focus:border-blue-500 focus:outline-none"
              />
              <span className="shrink-0 text-xs text-muted">
                {t("connections.importFromApp.group.parentLabel")}
              </span>
              <Select
                value={newGroupParent}
                options={[GROUP_NONE, ...groupTree.map((e) => e.group.id)]}
                labels={{
                  [GROUP_NONE]: t("connections.importFromApp.group.parentNone"),
                  ...Object.fromEntries(
                    groupTree.map((e) => [e.group.id, e.group.name]),
                  ),
                }}
                indents={Object.fromEntries(
                  groupTree.map((e) => [e.group.id, e.depth]),
                )}
                onChange={onNewGroupParentChange}
                searchable={groups.length > 6}
                className="w-44 min-w-0 shrink-0"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const StatusBadge = ({ item }: { item: ImportItem }) => {
  if (item.status.kind === "duplicate") {
    return <Copy size={16} className="shrink-0 text-blue-400" />;
  }
  if (item.status.kind === "warnings") {
    return <AlertTriangle size={16} className="shrink-0 text-amber-400" />;
  }
  return <CheckCircle2 size={16} className="shrink-0 text-green-400" />;
};
