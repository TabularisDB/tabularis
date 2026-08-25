import { useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";

const ENVIRONMENTS = ["", "development", "staging", "production"] as const;

const ENV_TRIGGER_CLASS: Record<string, string> = {
  production: "text-red-400 border-red-400/40",
  staging: "text-amber-400 border-amber-400/40",
  development: "text-emerald-400 border-emerald-400/40",
};

const ENV_DOT_CLASS: Record<string, string> = {
  production: "bg-red-400",
  staging: "bg-amber-400",
  development: "bg-emerald-400",
};

interface EnvironmentSelectProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Environment classifier pill for the connection modal header. Same trigger
 * look as the previous native <select>, but opens the app-styled dropdown
 * menu instead of the OS one.
 */
export function EnvironmentSelect({ value, onChange }: EnvironmentSelectProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const labelFor = (env: string) =>
    env === "" ? t("environment.none") : t(`environment.${env}`);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={t("environment.label")}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={clsx(
          "flex items-center gap-1 text-xs bg-surface-secondary border border-strong rounded-full px-2 py-0.5 font-medium outline-none cursor-pointer transition-colors",
          ENV_TRIGGER_CLASS[value] ?? "text-muted",
        )}
      >
        {labelFor(value)}
        <ChevronDown size={12} className="opacity-70" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            role="listbox"
            className="absolute right-0 top-full mt-1 z-50 min-w-[150px] bg-elevated border border-strong rounded-lg shadow-xl py-1"
          >
            {ENVIRONMENTS.map((env) => (
              <button
                key={env}
                type="button"
                role="option"
                aria-selected={value === env}
                onClick={() => {
                  onChange(env);
                  setIsOpen(false);
                }}
                className={clsx(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors",
                  value === env
                    ? "text-primary font-medium bg-surface-secondary/60"
                    : "text-secondary hover:bg-surface-secondary hover:text-primary",
                )}
              >
                <span
                  className={clsx(
                    "w-2 h-2 rounded-full shrink-0",
                    ENV_DOT_CLASS[env] ?? "bg-surface-tertiary border border-strong",
                  )}
                />
                <span className="flex-1 truncate">{labelFor(env)}</span>
                {value === env && <Check size={12} className="shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
