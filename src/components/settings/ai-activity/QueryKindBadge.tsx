import { useLingui } from "@lingui/react/macro";
import clsx from "clsx";
import { getQueryKindBadgeStyle } from "../../../utils/aiActivity";
import { aiActivityQueryKind } from "../../../i18n/registries/aiActivityQueryKind";

interface QueryKindBadgeProps {
  kind: string | null;
}

export function QueryKindBadge({ kind }: QueryKindBadgeProps) {
  const { i18n } = useLingui();
  if (!kind) return null;
  const style = getQueryKindBadgeStyle(kind);
  const descriptor = aiActivityQueryKind[kind];
  const label = descriptor ? i18n._(descriptor) : kind;
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
