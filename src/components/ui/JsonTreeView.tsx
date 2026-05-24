import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import {
  JsonEditor,
  defaultTheme,
  githubDarkTheme,
  githubLightTheme,
  type JsonData,
  type Theme as JerTheme,
} from "json-edit-react";
import { ThemeContext } from "../../contexts/ThemeContext";
import type { Theme } from "../../types/theme";

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
          <div className="flex items-center gap-2 bg-base border border-strong rounded px-2 py-1.5 focus-within:border-blue-500 transition-colors flex-shrink-0">
            <Search size={14} className="text-muted shrink-0" />
            <input
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
            enableClipboard={enableClipboard}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!externalSearchProvided && (
        <div className="flex items-center gap-2 bg-base border border-strong rounded px-2 py-1.5 focus-within:border-blue-500 transition-colors">
          <Search size={14} className="text-muted shrink-0" />
          <input
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
          enableClipboard={enableClipboard}
        />
      </div>
    </div>
  );
};
