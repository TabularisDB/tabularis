import { useContext, useEffect, useRef } from "react";
import MonacoEditor, {
  type BeforeMount,
  type OnValidate,
} from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor";
import { ThemeContext } from "../../contexts/ThemeContext";
import { loadMonacoTheme } from "../../themes/themeUtils";

interface CellCodeEditorProps {
  value: string;
  onChange: (text: string) => void;
  onValidate?: (markers: MonacoTypes.editor.IMarker[]) => void;
  height?: string | number;
  readOnly?: boolean;
  language?: "json" | "plaintext";
}

const DEFAULT_THEME = "vs-dark";

export const CellCodeEditor = ({
  value,
  onChange,
  onValidate,
  height = "100%",
  readOnly = false,
  language = "json",
}: CellCodeEditorProps) => {
  const themeCtx = useContext(ThemeContext);
  const currentTheme = themeCtx?.currentTheme;
  const monacoRef = useRef<typeof MonacoTypes | null>(null);

  useEffect(() => {
    if (monacoRef.current && currentTheme) {
      loadMonacoTheme(currentTheme, monacoRef.current);
    }
  }, [currentTheme]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    if (currentTheme) {
      loadMonacoTheme(currentTheme, monaco);
    }
  };

  const handleChange = (next: string | undefined) => {
    onChange(next ?? "");
  };

  const handleValidate: OnValidate = (markers) => {
    onValidate?.(markers);
  };

  return (
    <MonacoEditor
      height={height}
      language={language}
      theme={currentTheme?.id ?? DEFAULT_THEME}
      value={value}
      beforeMount={handleBeforeMount}
      onChange={handleChange}
      onValidate={handleValidate}
      options={{
        readOnly,
        minimap: { enabled: false },
        lineNumbers: "on",
        automaticLayout: true,
        formatOnPaste: language === "json",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        wrappingIndent: "indent",
      }}
    />
  );
};
