import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Select } from "../ui/Select";
import type { SavedQuery, SavedQueryFolder } from "../../contexts/SavedQueriesContext";
import { UNFILED_OPTION } from "../../utils/savedQueryFolders";
import { toErrorMessage } from "../../utils/errors";

interface MoveSavedQueryModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: SavedQuery | null;
  folders: SavedQueryFolder[];
  /** A null folderId moves the query to Unfiled. */
  onMove: (queryId: string, folderId: string | null) => Promise<void>;
}

interface MoveFormProps extends Omit<MoveSavedQueryModalProps, "isOpen" | "query"> {
  query: SavedQuery;
}

// The form only exists while the modal is open, so its state starts fresh on
// every open and needs no reset effect.
const MoveForm = ({ onClose, query, folders, onMove }: MoveFormProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const selectId = useId();
  const errorId = useId();
  const [target, setTarget] = useState<string>(query.folder_id ?? UNFILED_OPTION);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const options = [UNFILED_OPTION, ...folders.map((f) => f.id)];
  const labels: Record<string, string> = {
    [UNFILED_OPTION]: t("sidebar.unfiledFolderOption"),
    ...Object.fromEntries(folders.map((f) => [f.id, f.name])),
  };
  const current = query.folder_id ?? UNFILED_OPTION;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onMove(query.id, target === UNFILED_OPTION ? null : target);
      onClose();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col"
    >
      <div className="flex items-center justify-between p-4 border-b border-default bg-base">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-accent-primary/15 rounded-lg shrink-0">
            <Folder size={20} className="text-accent" />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-primary truncate">
              {t("sidebar.moveToFolderTitle", { name: query.name })}
            </h2>
            <p className="text-xs text-secondary">{t("sidebar.moveToFolderSubtitle")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.cancel")}
          className="text-secondary hover:text-primary transition-colors rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
        <div className="p-6 space-y-6 overflow-y-auto">
          <div>
            <label htmlFor={selectId} className="block text-xs uppercase font-bold text-muted mb-2">
              {t("sidebar.folderField")}
            </label>
            <Select
              id={selectId}
              value={target}
              options={options}
              labels={labels}
              onChange={(value) => {
                setTarget(value);
                setError("");
              }}
              searchable={options.length > 8}
              ariaDescribedBy={error ? errorId : undefined}
            />
            {folders.length === 0 && (
              <p className="text-xs text-muted mt-2">{t("sidebar.noFoldersYet")}</p>
            )}
            {error && (
              <div id={errorId} role="alert" className="text-accent-error text-xs mt-2">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || target === current}
            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {t("sidebar.moveAction")}
          </button>
        </div>
      </form>
    </div>
  );
};

export const MoveSavedQueryModal = ({ isOpen, query, ...props }: MoveSavedQueryModalProps) => (
  <Modal isOpen={isOpen && query !== null} onClose={props.onClose}>
    {query && <MoveForm key={query.id} query={query} {...props} />}
  </Modal>
);
