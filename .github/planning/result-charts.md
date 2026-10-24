# Design: Charts for query results (#1168)

> Plan for review in this PR, as asked in #1168. A first implementation of
> this plan is in the same PR so it can be tried, but everything here is open
> to change before merge.

## Where it lives

- A `Grid | Chart` toggle on the right of the result status bar, next to
  pagination. It covers the single result of a query tab, the active entry in
  the multi-result Tabs view, and the detached results window.
- Chart view replaces only the grid area. The status bar and pagination stay
  put. The data toolbar drops the grid-only actions (New Row, Delete Row and the
  copy format, delimiter and header controls) and shows only the
  pending-changes bar, while edits are pending, so Submit and Rollback stay
  reachable. Row selection, pending edits and scroll position already live on
  the tab or entry, so switching back to Grid restores them. Nothing changes
  until someone clicks Chart.

## Chart types and columns (v1)

- Bar and line, as the issue asks.
- X axis: any column, picked from a labelled select. Y axis: numeric columns,
  toggled as chips, up to 5 series. "Numeric" means every non-null loaded value
  is a number or a numeric string, so DECIMALs sent as strings count.
- Defaults: if a column looks like a date or time, it goes on X and the chart
  starts as a line. Otherwise the first text column goes on X and the chart
  starts as a bar. Y defaults to the first numeric column that isn't X, skipping
  `id`/`*_id` columns when there's another choice.
- Config is per result: per tab for a single result, per entry for multi-result.
  If a re-run drops or changes columns, it falls back to whatever still fits, or
  to new defaults.

## Data scope

- Only the rows already loaded, with no extra query. The toolbar shows "Rows
  plotted: N", plus "more rows not loaded" when the result is paginated.
  Changing the page redraws the chart.
- Capped at 1,000 points so a "page size: all" result can't freeze the SVG. When
  the cap applies, the note says "first 1,000 of N loaded". Column types are
  read from those same rows, once per result.
- NULL is missing data, not 0. Lines break at a NULL (`connectNulls` stays off,
  so the chart never draws values the query didn't return), bars leave the slot
  empty, and the tooltip shows a dash. A value with NULLs on both sides gets a
  marker so it stays visible.

## Library

- Recharts, which notebook charts already use. It's in the same Editor chunk
  through `NotebookView`, so there's no new dependency and the bundle doesn't
  grow. The theme palette hook moves out of `CellChart.tsx` so both charts
  share it (notebook output unchanged), and the chart reuses `transformResultToChartData`
  and the `CellChartConfig` shape, so persisted config in milestone two matches
  notebooks.

## Design notes

- It should look native. Colours come only from `currentTheme.colors`, and the
  controls use the existing segmented-control and chip styles and token classes.
  It has been checked against Tabularis Dark/Light, High Contrast, Nord and
  Solarized Light.
- Quiet chrome: horizontal hairline grid only, no axis ticks, compact Y labels
  (`1.2K`, `3.4M`), and long X labels truncated with the full value in the
  tooltip. Dates are formatted at the precision the data has: months for
  month-start dates, the time only for timestamps within a single day.
- Thin marks: bars max 24px wide and grouped 2px apart, with corners following
  the theme's small radius (square on High Contrast). Lines are 2px. Markers
  have a surface-coloured ring and appear only up to 40 points.
- Colour-blind safety: result charts use a different token order from notebooks
  (primary, warning, boolean, success, ...). I ran a protan/deutan separation
  check over all 12 built-in themes for 2, 3 and 4 series. This order passes 29
  of 36 cases; the notebook order passes 9. Colour follows the column, so hiding
  a series never repaints the others. Lines also get dash patterns after the
  first, and the Y chips carry a key that matches the mark (a block for bars, a
  stroke for lines), so colour is never the only cue.
- Motion: a 250ms ease-out entry and nothing else, turned off under
  `prefers-reduced-motion`. A running refresh dims the chart instead of blanking
  it.
- States: an empty state for no rows, and another for no numeric columns (with a
  "Show grid" button). There's a warning-toned note when the cap applies.
- Accessibility: every control is a native button or a labelled select with
  `aria-pressed` and a visible focus ring. The chart is a `<figure>` with a
  screen-reader caption. Recharts' keyboard layer lets you step through points
  with the arrow keys, and the tooltip follows focus. The Grid view is the full
  data table.

## Not in v1

Pie, area and scatter; export; persisted config; aggregation or grouping (rows
are charted as returned, so `GROUP BY` stays in SQL); charts in the stacked
multi-result view and in table-browse tabs.

## Questions

1. Should table tabs (browsing a table) get the toggle too, or only query
   results for now?
2. Is it OK to leave the stacked multi-result view out of v1? Items can be about
   70px tall, which is too cramped for a chart.
3. Result charts now keep NULL as a gap. Notebook charts still turn NULL into 0
   through `transformResultToChartData`. Should they get the same fix in a small
   follow-up? Same question for adopting the colour-blind-checked colour order
   in notebook charts.

Plugin drivers: there's nothing driver-specific. It works on any materialized
result and generates no SQL.
