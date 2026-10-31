import { usePluginTranslation, type PluginQueryResult } from "@tabularis/plugin-api";
import { displayValue } from "../utils/data";

export function DataTable({ data }: { data: PluginQueryResult }) {
  const t = usePluginTranslation("neon");
  if (!data.rows.length) return <div className="neon-empty">{t("empty")}</div>;
  return <div className="neon-grid"><table>
    <thead><tr>{data.columns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead>
    <tbody>{data.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{displayValue(value)}</td>)}</tr>)}</tbody>
  </table></div>;
}
