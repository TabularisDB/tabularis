import { plural } from "@lingui/core/macro";
import { Trans } from "react-i18next";
import { useLingui } from "@lingui/react/macro";

export function Demo({ count, name, time, dynamicKey }: Props) {
  const { t } = useLingui();
  return (
    <div>
      <button>{t`Close`}</button>
      <span>{plural(count, { one: "Delete # row", other: "Delete # rows" })}</span>
      <span>{plural(count, { one: "# row · {time}ms", other: "# rows · {time}ms" })}</span>
      <p>{t`Delete index "${name}"?`}</p>
      <p>{t({ message: "Delete", context: "generateSQL" })}</p>
      <p>{t({ message: "Copy as `column`" })}</p>
      <p>{t(dynamicKey)}</p>
      <Trans i18nKey="schema.close" />
    </div>
  );
}
