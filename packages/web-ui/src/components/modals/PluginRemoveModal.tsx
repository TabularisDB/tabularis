import { useTranslation } from "react-i18next";
import { ConfirmModal } from "./ConfirmModal";

interface PluginRemoveModalProps {
  isOpen: boolean;
  onClose: () => void;
  pluginName: string;
  onConfirm: () => void;
}

export const PluginRemoveModal = ({
  isOpen,
  onClose,
  pluginName,
  onConfirm,
}: PluginRemoveModalProps) => {
  const { t } = useTranslation();

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("settings.plugins.removeTitle")}
      message={t("settings.plugins.confirmRemove", { name: pluginName })}
      confirmLabel={t("settings.plugins.remove")}
      onConfirm={onConfirm}
    />
  );
};
