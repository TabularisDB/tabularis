import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, GitCompare } from "lucide-react";
import { CellCodeEditor } from "./CellCodeEditor";
import { CellDiffEditor } from "./CellDiffEditor";
import {
  MIN_SIDE_BY_SIDE_WIDTH,
  useContainerWidth,
} from "../../hooks/useContainerWidth";
import {
  formatJsonForEditor,
  parseJsonEditorValue,
  validateJson,
} from "../../utils/json";

interface JsonExpansionEditorProps {
  value: unknown;
  readOnly: boolean;
  onSave: (next: unknown) => void;
  onCancel: () => void;
  originalValue?: unknown;
}

export const JsonExpansionEditor = ({
  value,
  readOnly,
  onSave,
  onCancel,
  originalValue,
}: JsonExpansionEditorProps) => {
  const { t } = useTranslation();
  const initial = useMemo(() => formatJsonForEditor(value), [value]);
  const originalText = useMemo(
    () =>
      originalValue !== undefined ? formatJsonForEditor(originalValue) : null,
    [originalValue],
  );
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [prevInitial, setPrevInitial] = useState(initial);
  const [diffEnabled, setDiffEnabled] = useState(true);
  const [sideBySide, setSideBySide] = useState(false);
  const { ref: rootRef, width: containerWidth } = useContainerWidth<HTMLDivElement>();
  const sideBySideFits = containerWidth >= MIN_SIDE_BY_SIDE_WIDTH;
  const renderSideBySide = sideBySide && sideBySideFits;

  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setDraft(initial);
    setError(null);
  }

  const isDirty = draft !== initial;
  const hasError = error !== null;
  const hasDiff = originalText !== null && originalText !== draft;
  const showDiff = diffEnabled && hasDiff && originalText !== null;

  const handleChange = (next: string) => {
    setDraft(next);
    setError(validateJson(next));
  };

  const handleSave = () => {
    if (hasError) return;
    onSave(parseJsonEditorValue(draft));
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
                  ? "bg-blue-600/30 text-blue-100 border-blue-500/50"
                  : "bg-surface-secondary text-secondary border-default hover:bg-surface-tertiary"
              }`}
              title={t("jsonInput.diff", { defaultValue: "Diff" })}
            >
              <GitCompare size={12} />
              {t("jsonInput.diff", { defaultValue: "Diff" })}
              {hasDiff && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-400"
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
                    ? "bg-blue-600/30 text-blue-100 border-blue-500/50"
                    : "bg-surface-secondary text-secondary border-default hover:bg-surface-tertiary"
                }`}
                title={t("jsonInput.sideBySide", { defaultValue: "Side by side" })}
              >
                <Columns2 size={12} />
                {t("jsonInput.sideBySide", { defaultValue: "Side by side" })}
              </button>
            )}
          </div>
        ) : (
          <span />
        )}
        {!readOnly && (
          <div className="flex items-center gap-2">
            {error && (
              <span
                className="text-red-400 mr-auto truncate"
                title={error}
                data-testid="json-expansion-error"
              >
                {error}
              </span>
            )}
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
              disabled={hasError || !isDirty}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
            >
              {t("jsonViewer.save")}
            </button>
          </div>
        )}
      </div>
      <div className="h-[320px] border border-default rounded overflow-hidden">
        {showDiff ? (
          <CellDiffEditor
            language="json"
            original={originalText}
            modified={draft}
            onChange={handleChange}
            readOnly={readOnly}
            height="100%"
            renderSideBySide={renderSideBySide}
          />
        ) : (
          <CellCodeEditor
            language="json"
            value={draft}
            onChange={handleChange}
            readOnly={readOnly}
            height="100%"
          />
        )}
      </div>
    </div>
  );
};
