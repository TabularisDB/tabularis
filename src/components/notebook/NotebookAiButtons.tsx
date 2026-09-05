import { useState } from "react";
import { AiQueryModal } from "../modals/AiQueryModal";
import { AiExplainModal } from "../modals/AiExplainModal";
import { AiDropdownButton } from "../ui/AiDropdownButton";

interface NotebookAiButtonsProps {
  content: string;
  onInsert: (sql: string) => void;
  connectionId: string;
  schema?: string;
}

export function NotebookAiButtons({
  content,
  onInsert,
  connectionId,
  schema,
}: NotebookAiButtonsProps) {
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isExplainOpen, setIsExplainOpen] = useState(false);

  return (
    <>
      <div className="absolute bottom-1 right-2 z-10 flex items-center gap-1">
        <AiDropdownButton
          onGenerate={() => setIsGenerateOpen(true)}
          onExplain={() => setIsExplainOpen(true)}
          disableAll={!connectionId}
          disableExplain={!content.trim()}
          compact
        />
      </div>

      <AiQueryModal
        isOpen={isGenerateOpen}
        onClose={() => setIsGenerateOpen(false)}
        connectionId={connectionId}
        schema={schema}
        onInsert={(sql) => {
          onInsert(sql);
          setIsGenerateOpen(false);
        }}
      />
      <AiExplainModal
        isOpen={isExplainOpen}
        onClose={() => setIsExplainOpen(false)}
        query={content}
      />
    </>
  );
}
