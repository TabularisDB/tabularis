// Companion to codemod.mjs: records the messages introduced *manually* during
// the Lingui conversion (dynamic-key registries, labelKey descriptors, the
// converted <Trans>, and the restored sidebar.actions key) into manifest.json.
//
// The codemod only records the static sites it transforms. Task-4 backfill maps
// each message -> its original i18next key(s) via manifest.originalKeys, so every
// manually introduced message must land here in the SAME entry shape the codemod
// uses: { kind, context, message, stem, forms, originalKeys }, keyed by msgid.
//
// `message` is the Lingui msgid (ICU `{var}` interpolation; literal `{{TOKEN}}`
// placeholders stay verbatim). Each entry pairs that msgid with the original
// i18next key(s) it replaced, so the backfill can pull each locale's text.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "manifest.json");

// [msgid, originalKey] pairs. msgid must match the registry/descriptor literal.
export const ENTRIES = [
  // taskManagerProcessStatus
  ["running", "taskManager.pluginProcesses.status.running"],
  ["stopped", "taskManager.pluginProcesses.status.stopped"],
  ["unknown", "taskManager.pluginProcesses.status.unknown"],

  // aiActivityQueryKind
  ["Select", "aiActivity.queryKind.select"],
  ["Write", "aiActivity.queryKind.write"],
  ["DDL", "aiActivity.queryKind.ddl"],
  ["Unknown", "aiActivity.queryKind.unknown"],

  // aiActivityStatus
  ["Success", "aiActivity.status.success"],
  ["Blocked (read-only)", "aiActivity.status.blocked_readonly"],
  ["Pending approval", "aiActivity.status.blocked_pending_approval"],
  ["Denied", "aiActivity.status.denied"],
  ["Error", "aiActivity.status.error"],
  ["Timeout", "aiActivity.status.timeout"],

  // notebookHistoryChange ({{n}} -> {n})
  ["Initial version", "editor.notebook.history.change.initial"],
  ["Edited cell {n}", "editor.notebook.history.change.editCell"],
  ["Added SQL cell {n}", "editor.notebook.history.change.addSql"],
  ["Added Markdown cell {n}", "editor.notebook.history.change.addMarkdown"],
  ["Deleted cell {n}", "editor.notebook.history.change.deleteCell"],
  ["Reordered cells", "editor.notebook.history.change.reorder"],
  ["Renamed cell {n}", "editor.notebook.history.change.renameCell"],
  ["Changed database (cell {n})", "editor.notebook.history.change.schemaCell"],
  ["Changed chart (cell {n})", "editor.notebook.history.change.chartCell"],
  ["Toggled parallel (cell {n})", "editor.notebook.history.change.parallelCell"],
  ["Collapsed/expanded cells", "editor.notebook.history.change.collapse"],
  ["Changed parameters", "editor.notebook.history.change.params"],
  ["Toggled stop on error", "editor.notebook.history.change.stopOnError"],
  ["Edited notebook", "editor.notebook.history.change.other"],

  // quickNavigatorType
  ["table", "editor.quickNavigator.type_table"],
  ["view", "editor.quickNavigator.type_view"],
  ["routine", "editor.quickNavigator.type_routine"],
  ["trigger", "editor.quickNavigator.type_trigger"],

  // openSourceLibrariesSections
  ["Frontend Dependencies", "settings.openSourceLibrariesSections.npm-runtime"],
  ["Frontend Dev Dependencies", "settings.openSourceLibrariesSections.npm-tooling"],
  ["Rust Dependencies", "settings.openSourceLibrariesSections.cargo-runtime"],
  ["Rust Build and Test", "settings.openSourceLibrariesSections.cargo-tooling"],

  // openSourceLibrariesEcosystem
  ["npm ecosystem", "settings.openSourceLibrariesEcosystem.npm"],
  ["Cargo ecosystem", "settings.openSourceLibrariesEcosystem.cargo"],

  // connectionAppearanceTabs
  ["Default", "connectionAppearance.tabs.default"],
  ["Icon", "connectionAppearance.tabs.pack"],
  ["Emoji", "connectionAppearance.tabs.emoji"],
  ["Image", "connectionAppearance.tabs.image"],

  // shortcutCategories
  ["Editor", "settings.shortcuts.categories.editor"],
  ["Navigation", "settings.shortcuts.categories.navigation"],
  ["Data Grid", "settings.shortcuts.categories.data_grid"],

  // sidebarDateGroups
  ["Today", "sidebar.dateGroupToday"],
  ["Yesterday", "sidebar.dateGroupYesterday"],
  ["This Week", "sidebar.dateGroupThisWeek"],
  ["This Month", "sidebar.dateGroupThisMonth"],
  ["Older", "sidebar.dateGroupOlder"],

  // aiPromptKinds (label / desc / placeholder); {{TOKEN}} stays literal
  ["SQL Generation", "settings.ai.systemPrompt"],
  ["Query Explanation", "settings.ai.explainPrompt"],
  ["Notebook Cell Name Prompt", "settings.ai.cellnamePrompt"],
  ["Query Tab Name Prompt", "settings.ai.tabrenamePrompt"],
  ["Explain Plan Analysis Prompt", "settings.ai.explainplanPrompt"],
  [
    "Instructions for AI-powered SQL generation. Use {{SCHEMA}} as a placeholder for the database structure.",
    "settings.ai.systemPromptDesc",
  ],
  [
    "Instructions for AI-powered query explanation. Use {{LANGUAGE}} as a placeholder for the output language.",
    "settings.ai.explainPromptDesc",
  ],
  [
    "Customize instructions for AI notebook cell name generation. The cell content (SQL or Markdown) is sent as the user message.",
    "settings.ai.cellnamePromptDesc",
  ],
  [
    "Customize instructions for AI query result tab name generation. The SQL query is sent as the user message.",
    "settings.ai.tabrenamePromptDesc",
  ],
  [
    "Customize instructions for AI analysis of EXPLAIN query plans. Use {{LANGUAGE}} for the output language.",
    "settings.ai.explainplanPromptDesc",
  ],
  ["Enter system prompt...", "settings.ai.enterSystemPrompt"],
  ["Enter explain prompt...", "settings.ai.enterExplainPrompt"],
  ["Enter notebook cell name prompt...", "settings.ai.enterCellnamePrompt"],
  ["Enter query tab name prompt...", "settings.ai.enterTabrenamePrompt"],
  ["Enter explain plan analysis prompt...", "settings.ai.enterExplainplanPrompt"],

  // pluginBuiltinSettings (mysql.*)
  ["Max Allowed Packet", "settings.plugins.pluginSettings.builtin.mysql.maxAllowedPacket.label"],
  [
    "Maximum packet size used by the MySQL connector.",
    "settings.plugins.pluginSettings.builtin.mysql.maxAllowedPacket.description",
  ],
  ["Socket Timeout", "settings.plugins.pluginSettings.builtin.mysql.socketTimeout.label"],
  [
    "Socket timeout in milliseconds.",
    "settings.plugins.pluginSettings.builtin.mysql.socketTimeout.description",
  ],
  ["Connect Timeout", "settings.plugins.pluginSettings.builtin.mysql.connectTimeout.label"],
  [
    "Connection timeout in milliseconds.",
    "settings.plugins.pluginSettings.builtin.mysql.connectTimeout.description",
  ],
  ["Timezone", "settings.plugins.pluginSettings.builtin.mysql.timezone.label"],
  [
    "Session timezone sent to MySQL after connect.",
    "settings.plugins.pluginSettings.builtin.mysql.timezone.description",
  ],

  // dumpErrorKeys
  ["Please select at least Structure or Data", "dump.errorNoOption"],
  ["Please select at least one table", "dump.errorNoTables"],

  // k8sErrorKeys
  ["Connection name is required", "k8sConnections.errors.nameRequired"],
  ["Kubernetes context is required", "k8sConnections.errors.contextRequired"],
  ["Namespace is required", "k8sConnections.errors.namespaceRequired"],
  ['Resource type must be "service" or "pod"', "k8sConnections.errors.resourceTypeInvalid"],
  ["Resource name is required", "k8sConnections.errors.resourceNameRequired"],
  ["Port must be between 1 and 65535", "k8sConnections.errors.portInvalid"],

  // shortcutLabels
  ["Run query", "settings.shortcuts.runQuery"],
  ["Run query (in editor)", "settings.shortcuts.runQueryEditor"],
  ["New tab", "settings.shortcuts.newTab"],
  ["Close tab", "settings.shortcuts.closeTab"],
  ["Next page", "settings.shortcuts.nextPage"],
  ["Previous page", "settings.shortcuts.prevPage"],
  ["Switch tab", "settings.shortcuts.tabSwitcher"],
  ["Copy selection", "settings.shortcuts.copySelection"],
  ["Toggle sidebar", "settings.shortcuts.toggleSidebar"],
  ["Open connections", "settings.shortcuts.openConnections"],
  ["New connection", "settings.shortcuts.newConnection"],
  ["Switch to connection 1–9", "settings.shortcuts.switchConnection"],
  ["Import from Clipboard", "settings.shortcuts.pasteImportClipboard"],
  ["Run All Cells", "settings.shortcuts.notebookRunAll"],
  ["Quick Navigator", "settings.shortcuts.quickNavigator"],

  // Settings.tsx TAB_ITEMS labelKey descriptors
  ["General", "settings.general"],
  ["Plugins", "settings.plugins.title"],
  ["Appearance", "settings.appearance"],
  ["Localization", "settings.localization"],
  ["AI", "settings.ai.tab"],
  ["AI Activity", "settings.aiActivity"],
  ["Logs", "settings.logs"],
  ["Keyboard Shortcuts", "settings.shortcuts.title"],
  ["Info", "settings.info"],

  // AiActivityPanel labelKey descriptors
  ["Events", "aiActivity.tabs.events"],
  ["Sessions", "aiActivity.tabs.sessions"],

  // GenerateSQLModal labelKey descriptors
  ["Create Table", "generateSQL.tabCreateTable"],
  ["Select *", "generateSQL.tabSelectAll"],
  ["Select [fields]", "generateSQL.tabSelectFields"],
  ["Update", "generateSQL.tabUpdate"],
  ["Delete", "generateSQL.tabDelete"],

  // ExplainOverviewBar ternary + getExplainDriverLegend descriptors
  ["Actual rows exceed estimate", "editor.visualExplain.overEstimate"],
  ["Estimate exceeds actual rows", "editor.visualExplain.underEstimate"],
  [
    "PostgreSQL ANALYZE includes actual rows, timing, loops, and buffer counters when available.",
    "editor.visualExplain.postgresAnalyzeLegend1",
  ],
  [
    "Large estimate gaps usually indicate stale statistics or predicates the planner cannot model well.",
    "editor.visualExplain.postgresAnalyzeLegend2",
  ],
  [
    "PostgreSQL without ANALYZE shows planner estimates only.",
    "editor.visualExplain.postgresEstimateLegend1",
  ],
  [
    "Enable ANALYZE to inspect actual rows, timing, loops, and buffers.",
    "editor.visualExplain.postgresEstimateLegend2",
  ],
  [
    "MySQL and MariaDB expose actual metrics only on supported EXPLAIN ANALYZE or ANALYZE FORMAT variants.",
    "editor.visualExplain.mysqlAnalyzeLegend1",
  ],
  [
    "Older servers may fall back to estimated plans with fewer metrics.",
    "editor.visualExplain.mysqlAnalyzeLegend2",
  ],
  [
    "MySQL and MariaDB may fall back to EXPLAIN FORMAT=JSON or tabular EXPLAIN depending on server version.",
    "editor.visualExplain.mysqlEstimateLegend1",
  ],
  [
    "If timing is missing, the server likely returned an estimate-only plan.",
    "editor.visualExplain.mysqlEstimateLegend2",
  ],
  [
    "SQLite EXPLAIN QUERY PLAN is lightweight and mostly structural.",
    "editor.visualExplain.sqliteLegend1",
  ],
  [
    "Cost, timing, and row estimates are often unavailable compared with PostgreSQL and MySQL.",
    "editor.visualExplain.sqliteLegend2",
  ],

  // Ternary sites (NotebookCellHeader, ClipboardImport)
  ["Expand Cell", "editor.notebook.expandCell"],
  ["Collapse Cell", "editor.notebook.collapseCell"],
  ["Minimize", "clipboardImport.minimize"],
  ["Maximize", "clipboardImport.maximize"],

  // Restored broken ref
  ["Actions", "sidebar.actions"],

  // Converted <Trans> (AiTab modelNotFound)
  [
    "Model <0>{0}</0> not found in <1>{1}</1>. It may not work correctly.",
    "settings.ai.modelNotFound",
  ],
];

export function applyToManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

  let added = 0;
  for (const [message, key] of ENTRIES) {
    // No registry message carries a gettext context, so the manifest key is the
    // raw msgid (matching the codemod's `message + CONTEXT_DELIM + context` form
    // when context is null).
    const mkey = message;
    if (!manifest[mkey]) {
      manifest[mkey] = {
        kind: "registry",
        context: null,
        message,
        stem: null,
        forms: null,
        originalKeys: [],
      };
      added += 1;
    }
    if (!manifest[mkey].originalKeys.includes(key)) {
      manifest[mkey].originalKeys.push(key);
    }
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return added;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const added = applyToManifest();
  console.log(
    `registry manifest: ${ENTRIES.length} entries processed, ${added} new messages added`,
  );
}
