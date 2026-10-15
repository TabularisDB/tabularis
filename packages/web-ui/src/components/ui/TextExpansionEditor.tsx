import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, GitCompare } from "lucide-react";
import { CellCodeEditor } from "./CellCodeEditor";
import { CellDiffEditor } from "./CellDiffEditor";
import { formatTextForEditor } from "../../utils/text";
import {
  MIN_SIDE_BY_SIDE_WIDTH,
  useContainerWidth,
} from "../../hooks/useContainerWidth";

interface TextExpansionEditorProps {
  value: unknown;
  readOnly: boolean;
  onSave: (next: string) => void;
  onCancel: () => void;
  originalValue?: unknown;
}

export const TextExpansionEditor = ({
  value,
  readOnly,
  onSave,
  onCancel,
  originalValue,
}: TextExpansionEditorProps) => {
  const { t } = useTranslation();
  const initial = useMemo(() => formatTextForEditor(value), [value]);
  const originalText = useMemo(
    () =>
      originalValue !== undefined ? formatTextForEditor(originalValue) : null,
    [originalValue],
  );
  const [draft, setDraft] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  const [diffEnabled, setDiffEnabled] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);
  const { ref: rootRef, width: containerWidth } = useContainerWidth<HTMLDivElement>();
  const sideBySideFits = containerWidth >= MIN_SIDE_BY_SIDE_WIDTH;
  const renderSideBySide = sideBySide && sideBySideFits;

  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setDraft(initial);
  }

  const isDirty = draft !== initial;
  const hasDiff = originalText !== null && originalText !== draft;
  const showDiff = diffEnabled && hasDiff && originalText !== null;

  const handleSave = () => {
    onSave(draft);
  };

  return (
    <div ref={rootRef} className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        {originalText !== null ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDiffEnabled((v) => !v)}
              aria-pressed={diffEnabled}
              disabled={!hasDiff}
              className={`px-2 py-1 rounded border transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed ${
                showDiff
                  ? "bg-accent-primary/30 text-accent border-accent-primary/50"
                  : "bg-surface-secondary text-secondary border-default hover:bg-surface-tertiary"
              }`}
              title={t("textInput.diff", { defaultValue: "Diff" })}
            >
              <GitCompare size={12} />
              {t("textInput.diff", { defaultValue: "Diff" })}
              {hasDiff && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-accent-warning"
                />
              )}
            </button>
            {showDiff && sideBySideFits && (
              <button
                type="button"
                onClick={() => setSideBySide((v) => !v)}
                aria-pressed={sideBySide}
                className={`px-2 py-1 rounded border transition-colors flex items-center gap-1 ${
                  sideBySide
                    ? "bg-accent-primary/30 text-accent border-accent-primary/50"
                    : "bg-surface-secondary text-secondary border-default hover:bg-surface-tertiary"
                }`}
                title={t("textInput.sideBySide", { defaultValue: "Side by side" })}
              >
                <Columns2 size={12} />
                {t("textInput.sideBySide", { defaultValue: "Side by side" })}
              </button>
            )}
          </div>
        ) : (
          <span />
        )}
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1 text-secondary hover:text-primary transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty}
              className="px-3 py-1 bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-inverse rounded font-medium transition-colors"
            >
              {t("textViewer.save", { defaultValue: "Save" })}
            </button>
          </div>
        )}
      </div>
      <div className="h-[320px] border border-default rounded overflow-hidden">
        {showDiff ? (
          <CellDiffEditor
            language="plaintext"
            original={originalText}
            modified={draft}
            onChange={setDraft}
            readOnly={readOnly}
            height="100%"
            renderSideBySide={renderSideBySide}
          />
        ) : (
          <CellCodeEditor
            language="plaintext"
            value={draft}
            onChange={setDraft}
            readOnly={readOnly}
            height="100%"
          />
        )}
      </div>
    </div>
  );
};
