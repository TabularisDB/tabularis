import { useLingui } from "@lingui/react/macro";
import clsx from "clsx";
import { getStatusBadgeStyle } from "../../../utils/aiActivity";
import { aiActivityStatus } from "../../../i18n/registries/aiActivityStatus";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { i18n } = useLingui();
  const style = getStatusBadgeStyle(status);
  const descriptor = aiActivityStatus[status];
  const label = descriptor ? i18n._(descriptor) : status;
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
