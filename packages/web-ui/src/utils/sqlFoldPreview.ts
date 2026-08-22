import type * as Monaco from "monaco-editor";
import type { Dialect } from "./sqlSplitter";
import { getSqlQueryAtFoldLine } from "./sqlFolding";

const HOVER_DELAY_MS = 400;
const DISMISS_DELAY_MS = 150;
const PREVIEW_CHARACTER_LIMIT = 20_000;

function isFoldPlaceholder(element: HTMLElement | null): boolean {
  return Boolean(element?.closest(".inline-folded"));
}

function positionPreview(preview: HTMLElement, x: number, y: number): void {
  const margin = 12;
  const rect = preview.getBoundingClientRect();
  const left = Math.max(
    margin,
    Math.min(x, window.innerWidth - rect.width - margin),
  );
  const below = y + margin;
  const top = below + rect.height <= window.innerHeight - margin
    ? below
    : Math.max(margin, y - rect.height - margin);
  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
}

/** Installs a TablePro-style preview over Monaco's collapsed-fold placeholder. */
export function installSqlFoldPreview(
  editor: Monaco.editor.ICodeEditor,
  monaco: typeof Monaco,
  dialect: () => Dialect | string | undefined,
): Monaco.IDisposable {
  let preview: HTMLDivElement | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let activeLine: number | null = null;
  let requestId = 0;

  const cancelScheduledDismiss = (): void => {
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = null;
  };

  const dismiss = (): void => {
    requestId += 1;
    activeLine = null;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    cancelScheduledDismiss();
    preview?.remove();
    preview = null;
  };

  const scheduleDismiss = (): void => {
    cancelScheduledDismiss();
    dismissTimer = setTimeout(dismiss, DISMISS_DELAY_MS);
  };

  const show = async (query: string, x: number, y: number): Promise<void> => {
    const currentRequest = ++requestId;
    const truncated = query.length > PREVIEW_CHARACTER_LIMIT;
    const text = truncated ? query.slice(0, PREVIEW_CHARACTER_LIMIT) : query;
    const html = await monaco.editor.colorize(text, "sql", { tabSize: 2 });
    if (currentRequest !== requestId) return;

    const container = document.createElement("div");
    container.className = "sql-fold-preview";
    container.setAttribute("role", "tooltip");
    container.addEventListener("mouseenter", cancelScheduledDismiss);
    container.addEventListener("mouseleave", dismiss);

    const code = document.createElement("pre");
    code.className = "sql-fold-preview-code";
    code.innerHTML = html;
    container.appendChild(code);

    if (truncated) {
      const footer = document.createElement("div");
      footer.className = "sql-fold-preview-footer";
      footer.textContent = "Preview truncated";
      container.appendChild(footer);
    }

    document.body.appendChild(container);
    positionPreview(container, x, y);
    preview = container;
  };

  const mouseMove = editor.onMouseMove((event) => {
    const line = event.target.position?.lineNumber ?? null;
    if (!line || !isFoldPlaceholder(event.target.element)) {
      scheduleDismiss();
      return;
    }
    cancelScheduledDismiss();
    if (activeLine === line) return;

    dismiss();
    const model = editor.getModel();
    const query = model
      ? getSqlQueryAtFoldLine(model.getValue(), line, dialect())
      : null;
    if (!query) return;

    activeLine = line;
    const { posx, posy } = event.event;
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      void show(query, posx, posy);
    }, HOVER_DELAY_MS);
  });

  const disposables = [
    mouseMove,
    editor.onMouseLeave(scheduleDismiss),
    editor.onDidChangeModelContent(dismiss),
    editor.onDidScrollChange(dismiss),
  ];
  window.addEventListener("blur", dismiss);

  return {
    dispose() {
      dismiss();
      disposables.forEach((disposable) => disposable.dispose());
      window.removeEventListener("blur", dismiss);
    },
  };
}
