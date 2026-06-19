import { useTranslation, Trans } from "react-i18next";

export function Demo({ count, name, time, dynamicKey }: Props) {
  const { t } = useTranslation();
  return (
    <div>
      <button>{t("schema.close")}</button>
      <span>{t("dataGrid.deleteRows", { count })}</span>
      <span>{t("editor.notebook.cellResult", { count, time })}</span>
      <p>{t("sidebar.deleteIndexConfirm", { name })}</p>
      <p>{t("generateSQL.tabDelete")}</p>
      <p>{t("dataGrid.copyColumnNameQuoted")}</p>
      <p>{t(dynamicKey)}</p>
      <Trans i18nKey="schema.close" />
    </div>
  );
}
