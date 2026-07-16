import { useState, useEffect, useCallback, useRef } from "react";
import { X, Sparkles, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../../hooks/useDatabase";
import { useSettings } from "../../hooks/useSettings";
import { Modal } from "../ui/Modal";

interface AiQueryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (sql: string) => void;
  connectionId?: string;
  schema?: string;
}

interface SchemaLoadState {
  key: string;
  context: string;
  error: string | null;
}

export const AiQueryModal = ({
  isOpen,
  onClose,
  onInsert,
  connectionId,
  schema,
}: AiQueryModalProps) => {
  const { activeConnectionId, activeSchema } = useDatabase();
  const { settings } = useSettings();
  const resolvedConnectionId = connectionId ?? activeConnectionId;
  const resolvedSchema = schema ?? activeSchema ?? undefined;
  const schemaKey = `${resolvedConnectionId ?? ""}:${resolvedSchema ?? ""}`;
  
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaLoad, setSchemaLoad] = useState<SchemaLoadState>({
    key: "",
    context: "",
    error: null,
  });
  const inFlightSchemaLoad = useRef<{
    key: string;
    promise: Promise<string>;
  } | null>(null);
  const isSchemaLoading = Boolean(
    isOpen && resolvedConnectionId && schemaLoad.key !== schemaKey,
  );

  const loadSchema = useCallback((): Promise<string> => {
    if (!resolvedConnectionId) {
      return Promise.resolve("");
    }

    if (inFlightSchemaLoad.current?.key === schemaKey) {
      return inFlightSchemaLoad.current.promise;
    }

    const promise = invoke<string>("get_ai_schema_context", {
      connectionId: resolvedConnectionId,
      ...(resolvedSchema ? { schema: resolvedSchema } : {}),
    });
    inFlightSchemaLoad.current = { key: schemaKey, promise };
    const clearInFlight = () => {
      if (inFlightSchemaLoad.current?.promise === promise) {
        inFlightSchemaLoad.current = null;
      }
    };
    void promise.then(clearInFlight, clearInFlight);
    return promise;
  }, [resolvedConnectionId, resolvedSchema, schemaKey]);

  useEffect(() => {
    if (!isOpen || !resolvedConnectionId) {
      return;
    }

    let cancelled = false;
    void loadSchema()
      .then((context) => {
        if (!cancelled) {
          setSchemaLoad({ key: schemaKey, context, error: null });
        }
      })
      .catch((loadError: unknown) => {
        console.error("Failed to load schema:", loadError);
        if (!cancelled) {
          setSchemaLoad({
            key: schemaKey,
            context: "",
            error: "Failed to load database schema context",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, resolvedConnectionId, schemaKey, loadSchema]);

  const handleGenerate = async () => {
    if (!prompt.trim() || !settings.aiProvider) {
        setError("Please configure AI provider in Settings and enter a prompt.");
        return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const schemaContext =
        schemaLoad.key === schemaKey && schemaLoad.error === null
          ? schemaLoad.context
          : await loadSchema();
      const sql = await invoke<string>("generate_ai_query", {
        req: {
          provider: settings.aiProvider,
          model: settings.aiModel || "", // Default fallback handled by backend (first model in list)
          prompt,
          schema: schemaContext,
        }
      });
      onInsert(sql);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl w-[600px] shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default">
          <div className="flex items-center gap-2 text-primary font-medium">
            <Sparkles size={18} className="text-yellow-400" />
            <span>AI Query Assist</span>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {!settings.aiProvider && (
             <div className="bg-warning-bg border border-warning-border text-warning-text px-4 py-3 rounded text-sm">
                ⚠️ AI Provider not configured. Please go to Settings {'>'} AI.
             </div>
          )}

          <div>
            <label className="block text-sm font-medium text-secondary mb-2">
              Describe your query in natural language
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Find all users who signed up last month and ordered a 'Premium' plan..."
              className="w-full h-32 bg-base border border-strong rounded-lg p-3 text-primary focus:outline-none focus:border-focus transition-colors resize-none"
              autoFocus
              onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleGenerate();
                  }
              }}
            />
          </div>

          {(error || schemaLoad.error) && (
            <div className="text-error-text text-sm bg-error-bg p-2 rounded border border-error-border">
              {error || schemaLoad.error}
            </div>
          )}

          {isSchemaLoading && (
            <div className="flex items-center gap-2 text-xs text-muted">
                <Loader2 size={12} className="animate-spin" />
                Reading database schema...
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-default bg-elevated/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary hover:bg-surface-secondary rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isLoading || !prompt.trim() || !settings.aiProvider}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-primary rounded-lg text-sm font-medium transition-colors"
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate SQL
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
