import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../../ui/Select";

interface DefaultDatabaseSelectProps {
  /** The saved format uses the first selected database as the default. */
  databases: string[];
  onChange: (databases: string[]) => void;
}

export const DefaultDatabaseSelect = ({ databases, onChange }: DefaultDatabaseSelectProps) => {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-secondary">
        {t("newConnection.defaultDatabase")}
      </label>
      <Select
        id={id}
        ariaLabel={t("newConnection.defaultDatabase")}
        value={databases[0] ?? null}
        options={databases}
        onChange={(database) => {
          if (databases.includes(database)) {
            onChange([database, ...databases.filter((db) => db !== database)]);
          }
        }}
        searchPlaceholder={t("common.search")}
        noResultsLabel={t("common.noResults")}
      />
      <p className="text-xs text-muted">
        {t("newConnection.defaultDatabaseHint")}
      </p>
    </div>
  );
};
