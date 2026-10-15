import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "../../hooks/useTheme";
import type { QueryResult } from "../../types/editor";
import type { CellChartConfig, ChartType } from "../../types/notebook";
import {
  canRenderChart,
  getNumericColumns,
  getLabelColumns,
  transformResultToChartData,
} from "../../utils/notebookChart";

interface ChartPalette {
  /** Series colors, cycled in order. */
  series: string[];
  grid: string;
  tick: string;
  tooltipBackground: string;
  tooltipBorder: string;
  tooltipText: string;
  radius: string;
}

/** Chart colors follow the active theme so every palette keeps its own accents. */
function useChartPalette(): ChartPalette {
  const { currentTheme } = useTheme();
  const { accent, semantic, bg, border, text } = currentTheme.colors;
  return {
    series: [
      accent.primary,
      accent.success,
      accent.warning,
      accent.error,
      accent.secondary,
      semantic.boolean,
      accent.info,
      semantic.string,
    ],
    grid: border.subtle,
    tick: text.muted,
    tooltipBackground: bg.tooltip,
    tooltipBorder: border.default,
    tooltipText: text.primary,
    radius: currentTheme.layout.borderRadius.base,
  };
}

function tooltipStyle(palette: ChartPalette) {
  return {
    backgroundColor: palette.tooltipBackground,
    border: `1px solid ${palette.tooltipBorder}`,
    borderRadius: palette.radius,
    color: palette.tooltipText,
    fontSize: 11,
  };
}

interface ChartTypeSelectorProps {
  config: CellChartConfig;
  result: QueryResult;
  onConfigChange: (config: CellChartConfig) => void;
}

function ChartTypeSelector({
  config,
  result,
  onConfigChange,
}: ChartTypeSelectorProps) {
  const { t } = useTranslation();
  const numericCols = getNumericColumns(result);
  const labelCols = getLabelColumns(result);
  const chartTypes: ChartType[] = ["bar", "line", "pie"];

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-elevated border-b border-default flex-wrap">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted uppercase font-semibold">
          {t("editor.notebook.chartType")}
        </span>
        <div className="flex gap-0.5">
          {chartTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onConfigChange({ ...config, type })}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                config.type === type
                  ? "bg-accent-primary/20 text-accent font-semibold"
                  : "text-muted hover:text-secondary hover:bg-surface-secondary"
              }`}
            >
              {type.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted uppercase font-semibold">
          {t("editor.notebook.chartLabel")}
        </span>
        <select
          value={config.labelColumn}
          onChange={(e) =>
            onConfigChange({ ...config, labelColumn: e.target.value })
          }
          className="text-[10px] bg-surface-secondary border border-strong rounded px-1 py-0.5 text-secondary"
        >
          {labelCols.map((col) => (
            <option key={col} value={col}>
              {col}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted uppercase font-semibold">
          {t("editor.notebook.chartValues")}
        </span>
        <div className="flex gap-1">
          {numericCols.map((col) => {
            const isSelected = config.valueColumns.includes(col);
            return (
              <button
                key={col}
                type="button"
                onClick={() => {
                  const next = isSelected
                    ? config.valueColumns.filter((c) => c !== col)
                    : [...config.valueColumns, col];
                  if (next.length > 0) {
                    onConfigChange({ ...config, valueColumns: next });
                  }
                }}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  isSelected
                    ? "bg-accent-success/20 text-accent-success font-semibold"
                    : "text-muted hover:text-secondary hover:bg-surface-secondary"
                }`}
              >
                {col}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface CellChartProps {
  result: QueryResult;
  config: CellChartConfig;
  onConfigChange: (config: CellChartConfig) => void;
}

interface ChartViewProps {
  data: ReturnType<typeof transformResultToChartData>;
  valueColumns: string[];
  palette: ChartPalette;
}

function BarChartView({ data, valueColumns, palette }: ChartViewProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: palette.tick }} />
        <YAxis tick={{ fontSize: 10, fill: palette.tick }} />
        <Tooltip contentStyle={tooltipStyle(palette)} />
        {valueColumns.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {valueColumns.map((col, i) => (
          <Bar
            key={col}
            dataKey={col}
            fill={palette.series[i % palette.series.length]}
            radius={[3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineChartView({ data, valueColumns, palette }: ChartViewProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: palette.tick }} />
        <YAxis tick={{ fontSize: 10, fill: palette.tick }} />
        <Tooltip contentStyle={tooltipStyle(palette)} />
        {valueColumns.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {valueColumns.map((col, i) => (
          <Line
            key={col}
            type="monotone"
            dataKey={col}
            stroke={palette.series[i % palette.series.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function PieChartView({ data, valueColumns, palette }: ChartViewProps) {
  const valueCol = valueColumns[0];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip contentStyle={tooltipStyle(palette)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Pie
          data={data}
          dataKey={valueCol}
          nameKey="label"
          cx="50%"
          cy="50%"
          outerRadius="70%"
          label={({ name, percent }: { name?: string; percent?: number }) =>
            `${name ?? ""}: ${((percent ?? 0) * 100).toFixed(0)}%`
          }
          labelLine={false}
          style={{ fontSize: 10 }}
        >
          {data.map((_, i) => (
            <Cell
              key={`cell-${i}`}
              fill={palette.series[i % palette.series.length]}
            />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CellChart({ result, config, onConfigChange }: CellChartProps) {
  const palette = useChartPalette();
  if (!canRenderChart(result)) return null;

  const data = transformResultToChartData(result, config);
  if (data.length === 0) return null;

  return (
    <div className="border-t border-default">
      <ChartTypeSelector
        config={config}
        result={result}
        onConfigChange={onConfigChange}
      />
      <div className="h-[250px] p-2">
        {config.type === "bar" && (
          <BarChartView data={data} valueColumns={config.valueColumns} palette={palette} />
        )}
        {config.type === "line" && (
          <LineChartView data={data} valueColumns={config.valueColumns} palette={palette} />
        )}
        {config.type === "pie" && (
          <PieChartView data={data} valueColumns={config.valueColumns} palette={palette} />
        )}
      </div>
    </div>
  );
}
