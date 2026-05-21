import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Code,
  Columns2,
  FileText,
  GitCompare,
  Maximize2,
  Network,
  WrapText,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  formatJsonForEditor,
  parseJsonEditorValue,
  validateJson,
} from "../../utils/json";
import { CellCodeEditor } from "./CellCodeEditor";
import { CellDiffEditor } from "./CellDiffEditor";
import { JsonTreeView } from "./JsonTreeView";
import {
  MIN_SIDE_BY_SIDE_WIDTH,
  useContainerWidth,
} from "../../hooks/useContainerWidth";

type JsonInputMode = "code" | "tree" | "raw";

interface JsonInputProps {
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  // Hide the expand-to-window button. Used by JsonViewerPage to avoid recursion.
  disableExpand?: boolean;
  // Flex-fill the parent's height (needed inside JsonViewerPage where the
  // surrounding container has explicit height). Off by default because in
  // auto-height containers (sidebar) flex-fill collapses to 0.
  fillHeight?: boolean;
  originalValue?: unknown;
}

export const JsonInput: React.FC<JsonInputProps> = ({
  value,
  onChange,
  placeholder,
  className = "",
  readOnly = false,
  disableExpand = false,
  fillHeight = false,
  originalValue,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<JsonInputMode>("code");
  const valueKey = JSON.stringify(value);
  const [text, setText] = useState(() => formatJsonForEditor(value));
  const [error, setError] = useState<string | null>(null);
  const [prevValueKey, setPrevValueKey] = useState(valueKey);
  const [diffEnabled, setDiffEnabled] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);
  const { ref: rootRef, width: containerWidth } = useContainerWidth<HTMLDivElement>();
  const sideBySideFits = containerWidth >= MIN_SIDE_BY_SIDE_WIDTH;
  const renderSideBySide = sideBySide && sideBySideFits;

  if (valueKey !== prevValueKey) {
    setPrevValueKey(valueKey);
    setText(formatJsonForEditor(value));
    setError(null);
  }

  const applyTextChange = useCallback(
    (newText: string) => {
      setText(newText);
      const err = validateJson(newText);
      setError(err);
      if (!err) {
        onChange(parseJsonEditorValue(newText));
      }
    },
    [onChange],
  );

  const handleRawChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      applyTextChange(e.target.value);
    },
    [applyTextChange],
  );

  const handleCodeChange = useCallback(
    (next: string) => {
      applyTextChange(next);
    },
    [applyTextChange],
  );

  const handleTreeChange = useCallback(
    (next: unknown) => {
      setText(formatJsonForEditor(next));
      setError(null);
      onChange(next);
    },
    [onChange],
  );

  const handleFormat = useCallback(() => {
    if (text.trim() === "") return;
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      setText(formatted);
      setError(null);
      onChange(parsed);
    } catch {
      // already shown via error state
    }
  }, [text, onChange]);

  const treeValue = useMemo<unknown>(() => {
    if (error || text.trim() === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }, [error, text]);

  const originalText = useMemo(
    () =>
      originalValue !== undefined ? formatJsonForEditor(originalValue) : null,
    [originalValue],
  );
  const hasDiff = originalText !== null && originalText !== text;

  const modes: Array<{ key: JsonInputMode; label: string; Icon: typeof Code }> =
    [
      { key: "code", label: t("jsonInput.mode.code"), Icon: Code },
      { key: "tree", label: t("jsonInput.mode.tree"), Icon: Network },
      { key: "raw", label: t("jsonInput.mode.raw"), Icon: FileText },
    ];

  const isTextMode = mode === "code" || mode === "raw";

  const expandValue = useMemo<unknown>(() => {
    if (!error && text.trim() !== "") {
      try {
        return JSON.parse(text);
      } catch {
        return value;
      }
    }
    return value;
  }, [error, text, value]);

  const handleExpandToWindow = useCallback(async () => {
    try {
      await invoke<string>("open_json_viewer_window", {
        value: expandValue,
        originalValue: originalValue ?? expandValue,
        colName: "",
        rowLabel: null,
        readOnly,
        cellKey: null,
      });
    } catch (e) {
      console.error("Failed to open JSON viewer window:", e);
    }
  }, [expandValue, originalValue, readOnly]);

  const showToolbar = isTextMode || !disableExpand;

  const rootClass = fillHeight
    ? `flex flex-col gap-1 ${className}`
    : `space-y-1 ${className}`;
  const editorAreaClass = fillHeight
    ? "relative flex-1 min-h-[220px] flex flex-col"
    : "relative";

  return (
    <div ref={rootRef} className={rootClass}>
      {/* Mode selector */}
      <div
        role="tablist"
        aria-label={t("jsonInput.mode.code")}
        className={`inline-flex items-center gap-0.5 bg-surface-secondary border border-default rounded p-0.5 ${
          fillHeight ? "flex-shrink-0" : ""
        }`}
      >
        {modes.map(({ key, label, Icon }) => {
          const active = mode === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              data-mode={key}
              onClick={() => setMode(key)}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors ${
                active
                  ? "bg-base text-primary border border-strong"
                  : "text-secondary hover:bg-surface-tertiary border border-transparent"
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Editor area */}
      <div className={editorAreaClass}>
        {mode === "code" && (
          <div
            data-testid="json-input-code"
            className={`w-full border rounded-lg overflow-hidden transition-colors ${
              fillHeight ? "flex-1 min-h-[220px]" : ""
            } ${error ? "border-red-500" : "border-strong"}`}
            style={fillHeight ? undefined : { height: 220 }}
          >
            {diffEnabled && hasDiff && originalText !== null ? (
              <CellDiffEditor
                language="json"
                original={originalText}
                modified={text}
                onChange={handleCodeChange}
                readOnly={readOnly}
                height="100%"
                renderSideBySide={renderSideBySide}
              />
            ) : (
              <CellCodeEditor
                language="json"
                value={text}
                onChange={handleCodeChange}
                height="100%"
                readOnly={readOnly}
              />
            )}
          </div>
        )}

        {mode === "tree" && (
          <div
            data-testid="json-input-tree"
            className={fillHeight ? "flex-1 min-h-0 flex flex-col" : ""}
          >
            <JsonTreeView
              value={treeValue}
              onChange={handleTreeChange}
              readOnly={readOnly}
              fillHeight={fillHeight}
            />
          </div>
        )}

        {mode === "raw" && (
          <textarea
            data-testid="json-input-raw"
            value={text}
            onChange={handleRawChange}
            placeholder={placeholder || t("jsonInput.placeholder")}
            spellCheck={false}
            readOnly={readOnly}
            className={`w-full px-3 py-2 bg-base border rounded-lg text-primary font-mono text-sm resize-y focus:outline-none transition-colors ${
              fillHeight ? "flex-1 min-h-[120px]" : "min-h-[120px]"
            } ${
              error
                ? "border-red-500 focus:border-red-500"
                : "border-strong focus:border-blue-500"
            }`}
          />
        )}
      </div>

      {/* Toolbar */}
      {showToolbar && (
        <div
          className={`flex items-center justify-between ${
            fillHeight ? "flex-shrink-0" : ""
          }`}
        >
          <div className="flex items-center gap-2">
            {isTextMode && !readOnly && (
              <button
                type="button"
                onClick={handleFormat}
                disabled={!!error || text.trim() === ""}
                className="px-2 py-1 text-xs bg-surface-secondary text-secondary rounded border border-default hover:bg-surface-tertiary transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                title={t("jsonInput.format")}
              >
                <WrapText size={12} />
                {t("jsonInput.format")}
              </button>
            )}
            {mode === "code" && originalText !== null && (
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
            )}
            {mode === "code" && diffEnabled && hasDiff && sideBySideFits && (
              <button
                type="button"
                onClick={() => setSideBySide((v) => !v)}
                aria-pressed={sideBySide}
                className={`px-2 py-1 text-xs rounded border transition-colors flex items-center gap-1 ${
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
            {!disableExpand && (
              <button
                type="button"
                onClick={handleExpandToWindow}
                className="px-2 py-1 text-xs bg-surface-secondary text-secondary rounded border border-default hover:bg-surface-tertiary transition-colors flex items-center gap-1"
                title={t("jsonInput.expand")}
              >
                <Maximize2 size={12} />
                {t("jsonInput.expand")}
              </button>
            )}
          </div>

          {/* Validation indicator */}
          {isTextMode && (
            <div className="flex items-center gap-1 text-xs">
              {text.trim() !== "" &&
                (error ? (
                  <span className="text-red-400 flex items-center gap-1">
                    <X size={12} />
                    {t("jsonInput.invalid")}
                  </span>
                ) : (
                  <span className="text-green-400 flex items-center gap-1">
                    <Check size={12} />
                    {t("jsonInput.valid")}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Error detail */}
      {error && isTextMode && (
        <p className="text-xs text-red-400 break-words">{error}</p>
      )}
    </div>
  );
};
