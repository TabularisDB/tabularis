import { useContext, useEffect, useRef } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor";
import { ThemeContext } from "../../contexts/ThemeContext";
import { loadMonacoTheme } from "../../themes/themeUtils";

interface CellDiffEditorProps {
  original: string;
  modified: string;
  onChange?: (next: string) => void;
  height?: string | number;
  readOnly?: boolean;
  renderSideBySide?: boolean;
  language?: "json" | "plaintext";
}

const DEFAULT_THEME = "vs-dark";

export const CellDiffEditor = ({
  original,
  modified,
  onChange,
  height = "100%",
  readOnly = false,
  renderSideBySide = false,
  language = "json",
}: CellDiffEditorProps) => {
  const themeCtx = useContext(ThemeContext);
  const currentTheme = themeCtx?.currentTheme;
  const monacoRef = useRef<typeof MonacoTypes | null>(null);
  const editorRef = useRef<MonacoTypes.editor.IStandaloneDiffEditor | null>(
    null,
  );

  useEffect(() => {
    if (monacoRef.current && currentTheme) {
      loadMonacoTheme(currentTheme, monacoRef.current);
    }
  }, [currentTheme]);

  const handleMount: DiffOnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editorRef.current = editor;
    if (currentTheme) {
      loadMonacoTheme(currentTheme, monaco);
    }

    editor.getOriginalEditor().updateOptions({ readOnly: true });
    editor.getModifiedEditor().updateOptions({ readOnly });
    if (onChange) {
      editor.getModifiedEditor().onDidChangeModelContent(() => {
        onChange(editor.getModifiedEditor().getValue());
      });
    }
  };

  return (
    <DiffEditor
      key={renderSideBySide ? "sbs" : "inline"}
      height={height}
      language={language}
      theme={currentTheme?.id ?? DEFAULT_THEME}
      original={original}
      modified={modified}
      onMount={handleMount}
      options={{
        renderSideBySide,
        useInlineViewWhenSpaceIsLimited: false,
        minimap: { enabled: false },
        lineNumbers: "on",
        automaticLayout: true,
        scrollBeyondLastLine: false,
        wordWrap: "on",
        wrappingIndent: "indent",
        diffWordWrap: "on",
        renderOverviewRuler: false,
      }}
    />
  );
};
