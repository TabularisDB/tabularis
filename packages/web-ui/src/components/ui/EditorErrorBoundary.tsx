import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Home, RotateCcw, XCircle } from "lucide-react";
import type { TFunction } from "i18next";
import { useEditor } from "../../hooks/useEditor";

interface InnerProps {
  t: TFunction;
  onBackToConnections: () => void;
  onCloseActiveTab: (() => void) | null;
  children: ReactNode;
}

interface InnerState {
  error: Error | null;
  componentStack: string | null;
}

// Inner class component that catches render errors. Kept private so the
// public surface is the hook-aware wrapper below.
class EditorErrorBoundaryInner extends Component<InnerProps, InnerState> {
  state: InnerState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<InnerState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error(
      "[Editor] render crash caught by error boundary:",
      error,
      info.componentStack,
    );
  }

  reset = () => {
    this.setState({ error: null, componentStack: null });
  };

  closeActiveTabAndReset = () => {
    this.props.onCloseActiveTab?.();
    this.reset();
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) {
      return this.props.children;
    }

    const { t, onBackToConnections, onCloseActiveTab } = this.props;
    const details = [error.stack, componentStack].filter(Boolean).join("\n\n");

    return (
      <div
        role="alert"
        className="flex h-full w-full items-center justify-center bg-base p-8 overflow-auto"
      >
        <div className="w-full max-w-xl bg-elevated border border-strong rounded-xl shadow-lg p-6">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-900/30 rounded-lg shrink-0">
              <AlertTriangle size={24} className="text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-primary">
                {t("editor.errorBoundary.title")}
              </h2>
              <p className="mt-1 text-sm text-secondary">
                {t("editor.errorBoundary.description")}
              </p>

              <div className="mt-3 rounded-md border border-red-900/40 bg-red-900/10 px-3 py-2">
                <p className="text-sm font-mono text-red-400 break-words whitespace-pre-wrap">
                  {error.message || error.name}
                </p>
              </div>

              {details && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-secondary hover:text-primary select-none">
                    {t("editor.errorBoundary.showDetails")}
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-base/60 p-2 text-[11px] text-secondary whitespace-pre-wrap">
                    {details}
                  </pre>
                </details>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={this.reset}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
                >
                  <RotateCcw size={14} />
                  {t("editor.errorBoundary.retry")}
                </button>
                {onCloseActiveTab && (
                  <button
                    type="button"
                    onClick={this.closeActiveTabAndReset}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-base hover:bg-elevated border border-default text-primary rounded-md text-sm font-medium transition-colors"
                  >
                    <XCircle size={14} />
                    {t("editor.errorBoundary.closeCurrentTab")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onBackToConnections}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-base hover:bg-elevated border border-default text-primary rounded-md text-sm font-medium transition-colors"
                >
                  <Home size={14} />
                  {t("editor.errorBoundary.backToConnections")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

interface EditorErrorBoundaryProps {
  children: ReactNode;
}

export function EditorErrorBoundary({ children }: EditorErrorBoundaryProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeTabId, closeTab } = useEditor();

  const onCloseActiveTab = activeTabId ? () => closeTab(activeTabId) : null;

  return (
    <EditorErrorBoundaryInner
      t={t}
      onBackToConnections={() => navigate("/connections")}
      onCloseActiveTab={onCloseActiveTab}
    >
      {children}
    </EditorErrorBoundaryInner>
  );
}
