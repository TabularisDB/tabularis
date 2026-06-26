import { useRef, useEffect } from "react";
import MonacoEditor, { type BeforeMount } from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor";
import { useEditorTheme } from "../../hooks/useEditorTheme";
import { loadMonacoTheme } from "../../themes/themeUtils";

interface SqlPreviewProps {
  sql: string;
  className?: string;
  height?: string | number;
  showLineNumbers?: boolean;
}

export const SqlPreview = ({
  sql,
  className = "",
  height = "120px",
  showLineNumbers = false,
}: SqlPreviewProps) => {
  const editorTheme = useEditorTheme();
  const monacoRef = useRef<typeof MonacoTypes | null>(null);

  // Update Monaco theme when theme changes
  useEffect(() => {
    if (monacoRef.current) {
      loadMonacoTheme(editorTheme, monacoRef.current);
    }
  }, [editorTheme]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    // Load Monaco theme before editor is created
    loadMonacoTheme(editorTheme, monaco);
  };

  return (
    <div className={`sql-preview-wrapper rounded-lg overflow-hidden border border-default ${className}`}>
      <MonacoEditor
        height={height}
        language="sql"
        theme={editorTheme.id}
        value={sql}
        beforeMount={handleBeforeMount}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: showLineNumbers ? "on" : "off",
          glyphMargin: false,
          folding: false,
          lineNumbersMinChars: 5,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          renderLineHighlight: "none",
          contextmenu: false,
          wordWrap: "on",
          wrappingIndent: "indent",
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
};
