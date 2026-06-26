import { useState, useEffect, useRef } from "react";
import { X, Loader2, BookOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../hooks/useSettings";
import { useEditorTheme } from "../../hooks/useEditorTheme";
import { getAiExplanationLanguage } from "../../i18n/language";
import { Modal } from "../ui/Modal";
import MonacoEditor, { type BeforeMount } from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor";
import { loadMonacoTheme } from "../../themes/themeUtils";

interface AiExplainModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
}

export const AiExplainModal = ({ isOpen, onClose, query }: AiExplainModalProps) => {
  const { settings } = useSettings();
  const editorTheme = useEditorTheme();
  const monacoRef = useRef<typeof MonacoTypes | null>(null);
  const [explanation, setExplanation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update Monaco theme when theme changes
  useEffect(() => {
    if (monacoRef.current) {
      loadMonacoTheme(editorTheme, monacoRef.current);
    }
  }, [editorTheme]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    // Define the theme before the editor is created (Monaco themes are global)
    loadMonacoTheme(editorTheme, monaco);
  };

  useEffect(() => {
    if (isOpen && query) {
      handleExplain();
    }
    // eslint-disable-next-line
  }, [isOpen, query]);

  const handleExplain = async () => {
    if (!settings.aiProvider) {
        setError("Please configure AI provider in Settings.");
        return;
    }

    setIsLoading(true);
    setError(null);
    setExplanation("");

    try {
      const result = await invoke<string>("explain_ai_query", {
        req: {
          provider: settings.aiProvider,
          model: settings.aiModel || "",
          query,
          language: getAiExplanationLanguage(settings.language),
        }
      });
      setExplanation(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl w-[700px] shadow-2xl flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default">
          <div className="flex items-center gap-2 text-primary font-medium">
            <BookOpen size={18} className="text-blue-400" />
            <span>AI Query Explanation</span>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!settings.aiProvider && (
             <div className="bg-warning-bg border border-warning-border text-warning-text px-4 py-3 rounded text-sm">
                ⚠️ AI Provider not configured. Please go to Settings {'>'} AI.
             </div>
          )}

          {/* Original Query */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Query
            </label>
            <div className="h-32 border border-default rounded-lg overflow-hidden">
                <MonacoEditor
                    height="100%"
                    language="sql"
                    theme={editorTheme.id}
                    value={query}
                    beforeMount={handleBeforeMount}
                    options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 12,
                        wordWrap: 'on'
                    }}
                />
            </div>
          </div>

          {/* Explanation */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Explanation
            </label>
            <div className="bg-base border border-strong rounded-lg p-4 min-h-[150px] text-secondary leading-relaxed whitespace-pre-wrap">
                {isLoading ? (
                    <div className="flex items-center gap-2 text-muted">
                        <Loader2 size={16} className="animate-spin" />
                        Generating explanation...
                    </div>
                ) : error ? (
                    <div className="text-error-text">
                        {error}
                    </div>
                ) : (
                    explanation
                )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end p-4 border-t border-default bg-elevated/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface-secondary hover:bg-surface-tertiary text-primary rounded-lg text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
