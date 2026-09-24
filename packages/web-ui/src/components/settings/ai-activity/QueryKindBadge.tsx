import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { getQueryKindBadgeStyle } from "../../../utils/aiActivity";

interface QueryKindBadgeProps {
  kind: string | null;
}

export function QueryKindBadge({ kind }: QueryKindBadgeProps) {
  const { t } = useTranslation();
  if (!kind) return null;
  const style = getQueryKindBadgeStyle(kind);
  const label = t(`aiActivity.queryKind.${kind}`, { defaultValue: kind });
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase border",
        style.bg,
        style.text,
        style.border,
      )}
    >
      {label}
    </span>
  );
}
