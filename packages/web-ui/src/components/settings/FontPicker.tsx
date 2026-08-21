import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { AVAILABLE_FONTS } from "../../utils/settings";

interface FontPickerProps {
  value: string;
  onChange: (font: string) => void;
  getPreviewCSS: (fontName: string) => string;
  inputId: string;
}

export function FontPicker({
  value,
  onChange,
  getPreviewCSS,
  inputId,
}: FontPickerProps) {
  const { t } = useTranslation();
  const isPreset = AVAILABLE_FONTS.some((f) => f.name === value);
  const [customFont, setCustomFont] = useState(() =>
    !isPreset && value ? value : "",
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {AVAILABLE_FONTS.map((font) => (
        <button
          key={font.name}
          onClick={() => onChange(font.name)}
          className={clsx(
            "p-3 rounded-xl border transition-all text-left",
            value === font.name
              ? "bg-surface-secondary border-blue-500 shadow-lg shadow-blue-900/20"
              : "bg-base border-default hover:border-strong",
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-primary">
              {font.label}
            </span>
            {value === font.name && (
              <CheckCircle2 size={16} className="text-blue-500" />
            )}
          </div>
          <p
            className="text-xs text-muted truncate"
            style={{ fontFamily: getPreviewCSS(font.name) }}
          >
            Aa Bb Cc 123
          </p>
        </button>
      ))}

      {/* Custom font */}
      <button
        onClick={() =>
          (document.getElementById(inputId) as HTMLInputElement)?.focus()
        }
        className={clsx(
          "p-3 rounded-xl border transition-all text-left relative",
          !isPreset
            ? "bg-surface-secondary border-blue-500 shadow-lg shadow-blue-900/20"
            : "bg-base border-default hover:border-strong",
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-primary">
            {t("settings.fonts.custom")}
          </span>
          {!isPreset && (
            <CheckCircle2 size={16} className="text-blue-500" />
          )}
        </div>
        <div className="space-y-2">
          <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
            id={inputId}
            type="text"
            placeholder={t("settings.fonts.customPlaceholder")}
            value={customFont}
            onChange={(e) => setCustomFont(e.target.value)}
            onBlur={() => {
              if (customFont.trim()) onChange(customFont.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customFont.trim()) {
                onChange(customFont.trim());
                (e.target as HTMLInputElement).blur();
              }
            }}
            className={clsx(
              "w-full bg-base border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-blue-500 transition-colors",
              !isPreset && customFont === value
                ? "border-blue-500"
                : "border-strong",
            )}
          />
          <p
            className="text-xs text-muted truncate"
            style={{ fontFamily: customFont || "inherit" }}
          >
            {customFont || t("settings.fonts.enterFontName")}
          </p>
        </div>
      </button>
    </div>
  );
}
