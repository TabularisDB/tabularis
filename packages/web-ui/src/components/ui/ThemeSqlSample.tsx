import { useEffect, useMemo, useRef } from "react";
import { MonacoEditor } from "./LazyMonaco";
import type * as Monaco from "monaco-editor";
import { useEditorTheme } from "../../hooks/useEditorTheme";
import { resolveCatalogEntry } from "../../utils/themeCatalog";
import { loadMonacoTheme } from "../../themes/themeUtils";
import { getMonacoThemeId } from "../../themes/themeRuntime";
import type { NativeThemeContribution } from "../../types/themeCatalog";

/** Uses the shared renderer; never changes the independent editor preference. */
export function ThemeSqlSample({ contribution }: { contribution: NativeThemeContribution }) {
  const theme = useMemo(() => resolveCatalogEntry(contribution).resolved.theme, [contribution]);
  const editorTheme = useEditorTheme();
  const restore = useRef(editorTheme);
  const engine = useRef<typeof Monaco | null>(null);
  useEffect(() => { restore.current = editorTheme; }, [editorTheme]);
  useEffect(() => { if (engine.current) loadMonacoTheme(theme, engine.current); }, [theme]);
  useEffect(() => () => { if (engine.current) loadMonacoTheme(restore.current, engine.current); }, []);
  return <div className="rounded-lg border border-default overflow-hidden" aria-label="SQL">
    <MonacoEditor height="160px" language="sql" theme={getMonacoThemeId(theme.id)}
      value={"-- Preview only: no query is executed\nSELECT id, name, created_at, NULL AS note\nFROM customers\nWHERE active = TRUE AND total > 42.5\n  AND name LIKE 'Ada%'\nORDER BY created_at DESC;"}
      beforeMount={(monaco) => { engine.current = monaco; loadMonacoTheme(theme, monaco); }}
      options={{ readOnly: true, tabFocusMode: true, minimap: { enabled: false }, automaticLayout: true, fontSize: 13, scrollBeyondLastLine: false, contextmenu: false }} />
  </div>;
}
