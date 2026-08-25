import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, GitCompare } from "lucide-react";
import { formatTextForEditor } from "../../utils/text";
import { CellCodeEditor } from "./CellCodeEditor";
import { CellDiffEditor } from "./CellDiffEditor";
import {
  MIN_SIDE_BY_SIDE_WIDTH,
  useContainerWidth,
} from "../../hooks/useContainerWidth";

interface TextInputProps {
  value: unknown;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  originalValue?: unknown;
}

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  placeholder,
  className = "",
  readOnly = false,
  originalValue,
}) => {
  const { t } = useTranslation();
  const valueKey = useMemo(() => formatTextForEditor(value), [value]);
  const [text, setText] = useState(valueKey);
  const [prevValueKey, setPrevValueKey] = useState(valueKey);
  const [diffEnabled, setDiffEnabled] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);
  const { ref: rootRef, width: containerWidth } = useContainerWidth<HTMLDivElement>();
  const sideBySideFits = containerWidth >= MIN_SIDE_BY_SIDE_WIDTH;
  const renderSideBySide = sideBySide && sideBySideFits;

  if (valueKey !== prevValueKey) {
    setPrevValueKey(valueKey);
    setText(valueKey);
  }

  const applyTextChange = useCallback(
    (next: string) => {
      setText(next);
      onChange(next);
    },
    [onChange],
  );

  const originalText = useMemo(
    () =>
      originalValue !== undefined ? formatTextForEditor(originalValue) : null,
    [originalValue],
  );
  const hasDiff = originalText !== null && originalText !== text;

  return (
    <div ref={rootRef} className={`space-y-1 ${className}`}>
      <div className="relative">
        <div
          data-testid="text-input-code"
          className="w-full border border-strong rounded-lg overflow-hidden transition-colors"
          style={{ height: 220 }}
        >
          {diffEnabled && hasDiff && originalText !== null ? (
            <CellDiffEditor
              language="plaintext"
              original={originalText}
              modified={text}
              onChange={applyTextChange}
              readOnly={readOnly}
              height="100%"
              renderSideBySide={renderSideBySide}
            />
          ) : (
            <CellCodeEditor
              language="plaintext"
              value={text}
              onChange={applyTextChange}
              height="100%"
              readOnly={readOnly}
            />
          )}
        </div>
        {placeholder && text === "" && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 left-12 text-muted text-sm font-mono"
          >
            {placeholder}
          </span>
        )}
      </div>

      {originalText !== null && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDiffEnabled((v) => !v)}
            aria-pressed={diffEnabled}
            disabled={!hasDiff}
            className={`px-2 py-1 text-xs rounded border transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed ${
              diffEnabled && hasDiff
                ? "bg-blue-600/30 text-blue-100 border-blue-500/50"
                : "bg-surface-secondary text-secondary border-default hover:bg-surface-tertiary"
            }`}
            title={t("textInput.diff", { defaultValue: "Diff" })}
          >
            <GitCompare size={12} />
            {t("textInput.diff", { defaultValue: "Diff" })}
            {hasDiff && (
              <span
                aria-hidden
                className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-400"
              />
            )}
          </button>
          {diffEnabled && hasDiff && sideBySideFits && (
            <button
              type="button"
              onClick={() => setSideBySide((v) => !v)}
              aria-pressed={sideBySide}
              className={`px-2 py-1 text-xs rounded border transition-colors flex items-center gap-1 ${
                sideBySide
                  ? "bg-blue-600/30 text-blue-100 border-blue-500/50"
                  : "bg-surface-secondary text-secondary border-default hover:bg-surface-tertiary"
              }`}
              title={t("textInput.sideBySide", { defaultValue: "Side by side" })}
            >
              <Columns2 size={12} />
              {t("textInput.sideBySide", { defaultValue: "Side by side" })}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
