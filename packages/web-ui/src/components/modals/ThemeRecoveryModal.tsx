import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../hooks/useTheme";
import { AlertTriangle, CheckCircle2, Wrench } from "lucide-react";
import { ThemeDialog } from "../ui/ThemeDialog";
import { ThemeDialogButton } from "../ui/ThemeDialogButton";
import { InlineBanner } from "../ui/InlineBanner";

interface Props { isOpen: boolean; onClose: () => void }

export const ThemeRecoveryModal = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation();
  const { refreshCatalog } = useTheme();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const recover = async () => {
    setBusy(true); setNotes([]);
    try {
      const failures = await invoke<string[]>("recover_theme_packages");
      setChecked(true); setNotes(failures);
      try { await refreshCatalog(); }
      catch (error) { setNotes((previous) => [...previous, `${t("themePackages.refreshFailed")}: ${String(error)}`]); }
    } catch (error) { setNotes([String(error)]); }
    finally { setBusy(false); }
  };
  return <ThemeDialog isOpen={isOpen} onClose={onClose} icon={<Wrench size={20} />} title={t("themePackages.recover")} busy={busy}
    footer={<>
      <ThemeDialogButton disabled={busy} onClick={onClose}>{t("common.close")}</ThemeDialogButton>
      {(!checked || notes.length > 0) && <ThemeDialogButton variant="primary" busy={busy} icon={<Wrench size={16} />} onClick={() => void recover()}>{t(checked ? "common.retry" : "common.confirm")}</ThemeDialogButton>}
    </>}>
    <p className="text-sm leading-relaxed text-secondary">{t("themePackages.recoveryExplanation")}</p>
    {checked && <InlineBanner tone="neutral" role="status" icon={<CheckCircle2 size={16} />}>{t("themePackages.recoveryDone")}</InlineBanner>}
    {notes.length > 0 && <InlineBanner tone="amber" role="alert" icon={<AlertTriangle size={16} />}><ul className="space-y-2 break-words">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul></InlineBanner>}
  </ThemeDialog>;
};
