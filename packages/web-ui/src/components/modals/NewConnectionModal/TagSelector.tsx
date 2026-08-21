import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { Check, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { useConnectionTags } from "../../../hooks/useConnectionTags";
import type { ConnectionTag } from "../../../types/tags";
import { toErrorMessage } from "../../../utils/errors";
import { ConfirmModal } from "../ConfirmModal";
import { PALETTE } from "./palette";

/** Mirrors MAX_TAG_NAME_CHARS enforced by the backend. */
const MAX_TAG_NAME_CHARS = 32;

interface TagSelectorProps {
  /** Currently selected tag ids (order preserved). */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function Swatches({
  value,
  onPick,
}: {
  value: string;
  onPick: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          aria-label={`tag color ${c}`}
          className={clsx(
            "w-5 h-5 rounded-full flex items-center justify-center transition-transform hover:scale-110",
            value === c && "ring-2 ring-offset-1 ring-offset-base ring-blue-500",
          )}
          style={{ backgroundColor: c }}
        >
          {value === c && <Check size={10} className="text-white" />}
        </button>
      ))}
    </div>
  );
}

/**
 * Tag picker for the connection modal: toggleable chips of all existing tags,
 * an inline creator (name + color), and a management mode to rename, recolor
 * or delete tags globally.
 */
export function TagSelector({ selectedIds, onChange }: TagSelectorProps) {
  const { t } = useTranslation();
  const { tags, createTag, updateTag, deleteTag } = useConnectionTags();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[9]);
  const [managing, setManaging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(PALETTE[9]);
  const [error, setError] = useState<string | null>(null);
  const [deletingTag, setDeletingTag] = useState<ConnectionTag | null>(null);

  // Async handlers (create/delete) resolve after the user may have toggled
  // other chips; reading through the ref avoids clobbering those newer
  // selections with the stale closure value.
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id],
    );
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      const tag = await createTag(newName.trim(), newColor);
      onChange([...selectedIdsRef.current, tag.id]);
      setNewName("");
      setCreating(false);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const startEdit = (tag: ConnectionTag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
    setError(null);
  };

  const handleEditSave = async () => {
    if (!editingId || !editName.trim()) return;
    setError(null);
    try {
      await updateTag(editingId, editName.trim(), editColor);
      setEditingId(null);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingTag) return;
    const tag = deletingTag;
    setDeletingTag(null);
    setError(null);
    try {
      await deleteTag(tag.id);
      onChange(selectedIdsRef.current.filter((s) => s !== tag.id));
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-secondary uppercase tracking-wide">
          {t("tags.label")}
        </label>
        {tags.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setManaging((v) => !v);
              setEditingId(null);
              setError(null);
            }}
            className="flex items-center gap-1 text-[11px] text-muted hover:text-blue-400 transition-colors"
          >
            <Settings2 size={11} />
            {managing ? t("tags.done") : t("tags.manage")}
          </button>
        )}
      </div>

      {!managing && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {tags.map((tag) => {
            const selected = selectedIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.id)}
                aria-pressed={selected}
                className={clsx(
                  "flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-lg border transition-all",
                  selected ? "opacity-100" : "opacity-50 hover:opacity-80",
                )}
                style={{
                  color: tag.color,
                  backgroundColor: `${tag.color}1a`,
                  borderColor: selected ? tag.color : `${tag.color}33`,
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
                {selected && <Check size={11} />}
              </button>
            );
          })}
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1 text-xs text-muted border border-dashed border-strong px-2 py-1 rounded-lg hover:text-blue-400 hover:border-blue-500/50 transition-colors"
            >
              <Plus size={11} />
              {t("tags.new")}
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap w-full mt-1 p-2 rounded-lg border border-strong bg-base">
              <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreate();
                  }
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder={t("tags.namePlaceholder")}
                maxLength={MAX_TAG_NAME_CHARS}
                autoFocus
                spellCheck={false}
                aria-label={t("tags.namePlaceholder")}
                className="w-36 px-2 py-1 bg-elevated border border-strong rounded-md text-xs text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
              <Swatches value={newColor} onPick={setNewColor} />
              <div className="flex items-center gap-1 ml-auto">
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={!newName.trim()}
                  className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs transition-colors"
                >
                  {t("tags.add")}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  aria-label={t("common.cancel")}
                  className="p-1 rounded-md text-muted hover:text-primary transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {managing && (
        <div className="space-y-1">
          {tags.map((tag) =>
            editingId === tag.id ? (
              <div
                key={tag.id}
                className="flex items-center gap-2 flex-wrap p-2 rounded-lg border border-strong bg-base"
              >
                <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleEditSave();
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  maxLength={MAX_TAG_NAME_CHARS}
                  autoFocus
                  spellCheck={false}
                  aria-label={t("tags.namePlaceholder")}
                  className="w-36 px-2 py-1 bg-elevated border border-strong rounded-md text-xs text-primary focus:border-blue-500 focus:outline-none"
                />
                <Swatches value={editColor} onPick={setEditColor} />
                <div className="flex items-center gap-1 ml-auto">
                  <button
                    type="button"
                    onClick={() => void handleEditSave()}
                    disabled={!editName.trim()}
                    className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs transition-colors"
                  >
                    {t("common.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    aria-label={t("common.cancel")}
                    className="p-1 rounded-md text-muted hover:text-primary transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={tag.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-default/50"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-xs text-primary truncate flex-1">
                  {tag.name}
                </span>
                <button
                  type="button"
                  onClick={() => startEdit(tag)}
                  aria-label={t("common.edit")}
                  className="p-1 rounded-md text-muted hover:text-blue-400 transition-colors"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingTag(tag)}
                  aria-label={t("common.delete")}
                  className="p-1 rounded-md text-muted hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <ConfirmModal
        isOpen={deletingTag !== null}
        onClose={() => setDeletingTag(null)}
        title={t("tags.deleteTitle")}
        message={t("tags.deleteConfirm", { name: deletingTag?.name ?? "" })}
        variant="danger"
        onConfirm={() => void handleDeleteConfirm()}
        overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] backdrop-blur-sm"
      />
    </div>
  );
}
