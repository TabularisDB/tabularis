import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionAppearance } from "../../../contexts/DatabaseContext";

const PALETTE = [
  "#64748b", "#ef4444", "#f97316", "#f59e0b",
  "#eab308", "#84cc16", "#10b981", "#14b8a6",
  "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899",
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface Props {
  value: ConnectionAppearance;
  onChange: (next: ConnectionAppearance) => void;
  connectionId: string;
}

export function AppearanceSection({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(value.accentColor ?? "");
  const [hexError, setHexError] = useState<string | null>(null);

  function setAccent(c: string | undefined) {
    const next: ConnectionAppearance = { ...value };
    if (c) next.accentColor = c;
    else delete next.accentColor;
    const isEmpty = !next.accentColor && !next.icon;
    onChange(isEmpty ? {} : next);
  }

  function commitCustom() {
    if (!HEX_RE.test(customDraft)) {
      setHexError(t("connectionAppearance.errors.invalidHex"));
      return;
    }
    setHexError(null);
    const normalized = customDraft.toLowerCase();
    setCustomDraft(normalized);
    setAccent(normalized);
  }

  return (
    <section className="space-y-3 border-t border-zinc-800/60 pt-4 mt-4">
      <h3 className="text-sm font-medium text-zinc-200">{t("connectionAppearance.section")}</h3>

      <div>
        <label className="block text-xs text-zinc-400 mb-2">
          {t("connectionAppearance.accentColor")}
        </label>
        <div className="flex flex-wrap gap-2 items-center" role="group">
          {PALETTE.map(c => (
            <button
              key={c}
              type="button"
              aria-label={`color swatch ${c}`}
              aria-pressed={value.accentColor === c}
              onClick={() => setAccent(c)}
              className="rounded-full transition-transform hover:scale-110"
              style={{
                background: c,
                width: 24,
                height: 24,
                outline: value.accentColor === c ? "2px solid white" : "1px solid rgba(255,255,255,0.15)",
                outlineOffset: 0,
              }}
            />
          ))}
          <button
            type="button"
            aria-label="custom color"
            aria-expanded={customOpen}
            onClick={() => setCustomOpen(o => !o)}
            className="ml-1 text-zinc-400 hover:text-zinc-100 text-sm"
          >
            {t("connectionAppearance.customColor")}
          </button>
        </div>

        {customOpen && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              placeholder="#rrggbb"
              value={customDraft}
              onChange={e => { setCustomDraft(e.target.value); setHexError(null); }}
              onBlur={commitCustom}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm w-28 font-mono"
            />
            {hexError && <span role="alert" className="text-xs text-rose-400">{hexError}</span>}
          </div>
        )}

        {value.accentColor && (
          <button
            type="button"
            aria-label="reset color"
            onClick={() => setAccent(undefined)}
            className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 underline"
          >
            {t("connectionAppearance.resetColor")}
          </button>
        )}
      </div>
    </section>
  );
}
