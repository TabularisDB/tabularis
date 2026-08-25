import { useRef, useEffect } from "react";
import Markdown from "react-markdown";
import { useTranslation } from "react-i18next";
import type { NotebookCell } from "../../types/notebook";

interface MarkdownCellProps {
  cell: NotebookCell;
  onContentChange: (content: string) => void;
  onTogglePreview: () => void;
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div
      className={
        "prose-notebook text-sm text-secondary px-4 py-3 min-h-[60px] " +
        "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:text-primary " +
        "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:text-primary " +
        "[&_h3]:text-base [&_h3]:font-medium [&_h3]:mb-1 [&_h3]:text-primary " +
        "[&_p]:mb-2 [&_p]:leading-relaxed " +
        "[&_code]:bg-surface-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono " +
        "[&_pre]:bg-surface-secondary [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:mb-2 " +
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 " +
        "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 " +
        "[&_li]:mb-1 " +
        "[&_a]:text-blue-400 [&_a]:underline " +
        "[&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted " +
        "[&_hr]:border-default [&_hr]:my-4 " +
        "[&_table]:border-collapse [&_table]:w-full [&_table]:mb-2 " +
        "[&_th]:border [&_th]:border-default [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold " +
        "[&_td]:border [&_td]:border-default [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs " +
        "[&_strong]:font-semibold [&_strong]:text-primary " +
        "[&_em]:italic"
      }
    >
      <Markdown>{content}</Markdown>
    </div>
  );
}

function MarkdownEditor({
  content,
  onContentChange,
  placeholder,
}: {
  content: string;
  onContentChange: (content: string) => void;
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.max(80, textarea.scrollHeight)}px`;
    }
  }, [content]);

  // Prose field: natural-language input, so spellcheck/autocorrect stay ON; only the WebKit autofill pill is disabled.
  return (
    <textarea autoComplete="off" spellCheck={true}
      ref={textareaRef}
      value={content}
      onChange={(e) => onContentChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-base text-sm text-primary font-mono p-3 resize-none outline-none border-none min-h-[80px]"
    />
  );
}

export function MarkdownCell({
  cell,
  onContentChange,
  onTogglePreview,
}: MarkdownCellProps) {
  const { t } = useTranslation();

  if (cell.isPreview) {
    if (!cell.content.trim()) {
      return (
        <div
          className="px-4 py-3 text-sm text-muted italic cursor-pointer min-h-[60px] flex items-center"
          onDoubleClick={onTogglePreview}
        >
          {t("editor.notebook.markdownPlaceholder")}
        </div>
      );
    }

    return (
      <div onDoubleClick={onTogglePreview} className="cursor-pointer">
        <MarkdownPreview content={cell.content} />
      </div>
    );
  }

  return (
    <MarkdownEditor
      content={cell.content}
      onContentChange={onContentChange}
      placeholder={t("editor.notebook.markdownPlaceholder")}
    />
  );
}
