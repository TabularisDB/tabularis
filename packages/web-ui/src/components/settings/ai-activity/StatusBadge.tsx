import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { getStatusBadgeStyle } from "../../../utils/aiActivity";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();
  const style = getStatusBadgeStyle(status);
  const label = t(`aiActivity.status.${status}`, { defaultValue: status });
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap",
        style.bg,
        style.text,
        style.border,
      )}
    >
      {label}
    </span>
  );
}
