import { useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      title={t`Remove Plugin`}
      message={t`Are you sure you want to remove "${pluginName}"? This will delete the plugin files.`}
      confirmLabel={t({ message: "Remove", context: "settings" })}
      onConfirm={onConfirm}
    />
  );
};
