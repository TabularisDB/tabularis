import { useTranslation } from "react-i18next";
import clsx from "clsx";

interface BetaBadgeProps {
  className?: string;
}

/** Small "BETA" pill for features that are still experimental. */
export const BetaBadge = ({ className }: BetaBadgeProps) => {
  const { t } = useTranslation();
  return (
    <span
      className={clsx(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        "border border-amber-500/30 bg-amber-500/15 text-amber-400",
        className,
      )}
    >
      {t("common.beta")}
    </span>
  );
};
