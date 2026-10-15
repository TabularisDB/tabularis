import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Search } from "lucide-react";
import { usePlatformCapabilities } from "../../hooks/usePlatformCapabilities";
import {
  JsonEditor,
  defaultTheme,
  githubDarkTheme,
  githubLightTheme,
  type CustomNodeDefinition,
  type CustomNodeProps,
  type JsonData,
  type Theme as JerTheme,
} from "json-edit-react";
import { ThemeContext } from "../../contexts/ThemeContext";
import type { Theme } from "../../types/theme";
import { isColorString, isLinkString } from "../../utils/jsonValueDecorators";

export interface JsonTreeViewProps {
  value: unknown;
  onChange?: (next: unknown) => void;
  readOnly?: boolean;
  searchQuery?: string;
  onCopy?: (text: string) => void;
  /**
   * When true, the root becomes a flex column that fills its parent height
   * and the tree area scrolls internally. Use for tall containers like the
   * JsonViewerPage. Default (false) keeps the natural, content-sized layout
   * used by the row-editor sidebar.
   */
  fillHeight?: boolean;
}

function isThemeDark(theme: Theme | undefined): boolean {
  if (!theme) return true;
  return theme.monacoTheme.base !== "vs";
}

function buildTheme(theme: Theme | undefined): JerTheme {
  if (!theme) return defaultTheme;
  const base = isThemeDark(theme) ? githubDarkTheme : githubLightTheme;
  const { colors, typography } = theme;
  return {
    ...base,
    styles: {
      ...base.styles,
      container: {
        backgroundColor: colors.bg.base,
        color: colors.text.primary,
        border: `1px solid ${colors.border.strong}`,
        borderRadius: theme.layout.borderRadius.base,
        fontFamily: typography.fontFamily.mono,
        padding: `${theme.layout.spacing.sm} ${theme.layout.spacing.base}`,
      },
      property: { color: colors.text.secondary },
      string: { color: colors.semantic.string },
      number: { color: colors.semantic.number },
      boolean: { color: colors.semantic.boolean },
      null: { color: colors.semantic.null },
      bracket: { color: colors.text.muted },
      itemCount: { color: colors.text.muted },
      input: {
        backgroundColor: colors.bg.elevated,
        color: colors.text.primary,
        border: `1px solid ${colors.border.strong}`,
        borderRadius: theme.layout.borderRadius.sm,
        padding: `${theme.layout.spacing.xs} ${theme.layout.spacing.sm}`,
        fontFamily: typography.fontFamily.mono,
        outline: "none",
        minWidth: "12rem",
      },
      inputHighlight: {
        backgroundColor: colors.bg.elevated,
        border: `1px solid ${colors.border.focus}`,
        boxShadow: `0 0 0 2px ${colors.border.focus}33`,
      },
      iconEdit: { color: colors.text.muted },
      iconCopy: { color: colors.text.muted },
      iconOk: { color: colors.accent.success },
      iconCancel: { color: colors.accent.error },
      error: { color: colors.accent.error },
    },
  };
}

const LinkNode: React.FC<CustomNodeProps> = ({
  value,
  originalNode,
}) => {
  const platform = usePlatformCapabilities();
  const url = typeof value === "string" ? value.trim() : "";

  const handleOpen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await platform.openExternalUrl(url);
    } catch (err) {
      console.error("Failed to open URL:", err);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {originalNode}
      <button
        type="button"
        onClick={handleOpen}
        title={url}
        aria-label={`Open ${url}`}
        className="inline-flex items-center p-0.5 text-muted hover:text-primary transition-colors rounded focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus cursor-pointer"
      >
        <ExternalLink size={12} className="shrink-0" />
      </button>
    </span>
  );
};

const ColorSwatchNode: React.FC<CustomNodeProps> = ({
  value,
  originalNode,
}) => {
  const color = typeof value === "string" ? value.trim() : "";

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block w-3 h-3 rounded-sm border border-strong shrink-0"
        style={{ backgroundColor: color }}
      />
      {originalNode}
    </span>
  );
};

const CUSTOM_NODE_DEFINITIONS: CustomNodeDefinition[] = [
  {
    condition: ({ value }) => isLinkString(value),
    element: LinkNode,
    passOriginalNode: true,
    showOnView: true,
    showOnEdit: false,
  },
  {
    condition: ({ value }) => isColorString(value),
    element: ColorSwatchNode,
    passOriginalNode: true,
    showOnView: true,
    showOnEdit: false,
  },
];

export const JsonTreeView = ({
  value,
  onChange,
  readOnly,
  searchQuery,
  onCopy,
  fillHeight = false,
}: JsonTreeViewProps) => {
  const { t } = useTranslation();
  const themeContext = useContext(ThemeContext);
  const currentTheme = themeContext?.currentTheme;
  const [internalSearch, setInternalSearch] = useState("");

  const isViewOnly = readOnly === true || onChange === undefined;
  const externalSearchProvided = searchQuery !== undefined;
  const effectiveSearch = externalSearchProvided ? searchQuery : internalSearch;

  const editorTheme = useMemo(
    () => buildTheme(currentTheme),
    [currentTheme],
  );

  const handleSetData = isViewOnly
    ? undefined
    : (next: JsonData) => onChange!(next);

  const enableClipboard = onCopy
    ? (input: { stringValue: string; success: boolean }) => {
        if (input.success) onCopy(input.stringValue);
      }
    : true;

  if (fillHeight) {
    return (
      <div className="flex flex-col gap-2 h-full min-h-0">
        {!externalSearchProvided && (
          <div className="flex items-center gap-2 bg-base border border-strong rounded px-2 py-1.5 focus-within:border-focus transition-colors flex-shrink-0">
            <Search size={14} className="text-muted shrink-0" />
            <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
              type="text"
              role="searchbox"
              value={internalSearch}
              onChange={(e) => setInternalSearch(e.target.value)}
              placeholder={t("jsonInput.search")}
              spellCheck={false}
              className="w-full bg-transparent border-none text-sm text-primary focus:outline-none placeholder:text-muted"
            />
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto bg-base border border-strong rounded px-3 py-2">
          <JsonEditor
            data={value as JsonData}
            setData={handleSetData}
            restrictEdit={
              isViewOnly
                ? true
                : ({ value: v }) => typeof v === "object" && v !== null
            }
            restrictAdd={true}
            restrictDelete={true}
            restrictTypeSelection={true}
            searchText={effectiveSearch}
            searchFilter="all"
            theme={{
              ...editorTheme,
              styles: {
                ...editorTheme.styles,
                container: {
                  ...((editorTheme.styles?.container ?? {}) as Record<string, unknown>),
                  border: "none",
                  borderRadius: 0,
                  backgroundColor: "transparent",
                },
              },
            }}
            customNodeDefinitions={CUSTOM_NODE_DEFINITIONS}
            enableClipboard={enableClipboard}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!externalSearchProvided && (
        <div className="flex items-center gap-2 bg-base border border-strong rounded px-2 py-1.5 focus-within:border-focus transition-colors">
          <Search size={14} className="text-muted shrink-0" />
          <input autoCorrect="off" autoCapitalize="off" autoComplete="off"
            type="text"
            role="searchbox"
            value={internalSearch}
            onChange={(e) => setInternalSearch(e.target.value)}
            placeholder={t("jsonInput.search")}
            spellCheck={false}
            className="w-full bg-transparent border-none text-sm text-primary focus:outline-none placeholder:text-muted"
          />
        </div>
      )}
      <div className="max-h-[280px] overflow-auto bg-base border border-strong rounded [overflow-wrap:anywhere] [&_*]:!max-w-full">
        <JsonEditor
          data={value as JsonData}
          setData={handleSetData}
          restrictEdit={isViewOnly}
          restrictAdd={true}
          restrictDelete={true}
          restrictTypeSelection={true}
          searchText={effectiveSearch}
          searchFilter="all"
          theme={{
            ...editorTheme,
            styles: {
              ...editorTheme.styles,
              container: {
                ...((editorTheme.styles?.container ?? {}) as Record<string, unknown>),
                border: "none",
                borderRadius: 0,
                backgroundColor: "transparent",
              },
            },
          }}
          customNodeDefinitions={CUSTOM_NODE_DEFINITIONS}
          enableClipboard={enableClipboard}
        />
      </div>
    </div>
  );
};
