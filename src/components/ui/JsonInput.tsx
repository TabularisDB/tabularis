import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Check, X, WrapText } from "lucide-react";
import {
  formatJsonForEditor,
  validateJson,
  parseJsonEditorValue,
} from "../../utils/json";

interface JsonInputProps {
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
  className?: string;
}

/**
 * JSON editor with validation, formatting, and error feedback.
 * Used in the sidebar FieldEditor for JSON/JSONB columns.
 */
export const JsonInput: React.FC<JsonInputProps> = ({
  value,
  onChange,
  placeholder,
  className = "",
}) => {
  const { t } = useTranslation();
  const valueKey = JSON.stringify(value);
  const [text, setText] = useState(() => formatJsonForEditor(value));
  const [error, setError] = useState<string | null>(null);
  const [prevValueKey, setPrevValueKey] = useState(valueKey);

  if (valueKey !== prevValueKey) {
    setPrevValueKey(valueKey);
    setText(formatJsonForEditor(value));
    setError(null);
  }

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      setText(newText);

      const err = validateJson(newText);
      setError(err);

      if (!err) {
        onChange(parseJsonEditorValue(newText));
      }
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

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="relative">
        <textarea
          value={text}
          onChange={handleChange}
          placeholder={placeholder || t("jsonInput.placeholder")}
          spellCheck={false}
          className={`w-full px-3 py-2 bg-base border rounded-lg text-primary font-mono text-sm resize-y min-h-[120px] focus:outline-none transition-colors ${
            error
              ? "border-red-500 focus:border-red-500"
              : "border-strong focus:border-blue-500"
          }`}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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
        </div>

        {/* Validation indicator */}
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
      </div>

      {/* Error detail */}
      {error && (
        <p className="text-xs text-red-400 break-words">{error}</p>
      )}
    </div>
  );
};
