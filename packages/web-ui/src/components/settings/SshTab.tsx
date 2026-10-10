import { useTranslation } from "react-i18next";
import { SettingSection } from "./SettingControls";
import { SshConnectionsManager } from "../ssh/SshConnectionsManager";

export function SshTab() {
  const { t } = useTranslation();

  return (
    <div>
      <SettingSection
        title={t("sshConnections.title")}
        description={t("sshConnections.manageDesc")}
      >
        <SshConnectionsManager />
      </SettingSection>
    </div>
  );
}
