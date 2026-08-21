import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../hooks/useSettings";

interface CellNameAiButtonProps {
  content: string;
  onNameGenerated: (name: string) => void;
}

export function CellNameAiButton({
  content,
  onNameGenerated,
}: CellNameAiButtonProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [isLoading, setIsLoading] = useState(false);

  if (!settings.aiEnabled || !settings.aiProvider) return null;

  const handleGenerate = async () => {
    if (!content.trim() || isLoading) return;

    setIsLoading(true);
    try {
      const name = await invoke<string>("generate_cell_name", {
        req: {
          provider: settings.aiProvider,
          model: settings.aiModel || "",
          query: content,
        },
      });
      onNameGenerated(name.trim());
    } catch (e) {
      console.error("Failed to generate cell name:", e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={isLoading || !content.trim()}
      className="p-0.5 text-muted hover:text-purple-300 transition-colors rounded disabled:opacity-30 disabled:pointer-events-none"
      title={isLoading ? t("editor.notebook.generatingName") : t("editor.notebook.aiGenerateName")}
    >
      {isLoading ? (
        <Loader2 size={10} className="animate-spin" />
      ) : (
        <Sparkles size={10} />
      )}
    </button>
  );
}
