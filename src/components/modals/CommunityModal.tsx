import { useTranslation } from "react-i18next";
import { X, Github, Star } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GITHUB_URL, DISCORD_URL } from "../../config/links";
import { DiscordIcon } from "../icons/DiscordIcon";
import { SocialLinks } from "../SocialLinks";
import { Modal } from "../ui/Modal";

interface CommunityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommunityModal = ({ isOpen, onClose }: CommunityModalProps) => {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <Star size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">{t("community.title")}</h2>
              <p className="text-xs text-secondary">{t("community.subtitle")}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <p className="text-sm text-secondary leading-relaxed">
            {t("community.description")}
          </p>

          {/* GitHub Star */}
          <button
            onClick={() => openUrl(GITHUB_URL)}
            className="w-full flex items-center gap-4 p-4 bg-base border border-default rounded-lg hover:border-yellow-500/50 hover:bg-yellow-900/10 transition-all group cursor-pointer"
          >
            <div className="p-2.5 bg-surface-secondary rounded-lg group-hover:bg-yellow-900/20 transition-colors">
              <Github size={22} className="text-secondary group-hover:text-yellow-400 transition-colors" />
            </div>
            <div className="text-left flex-1">
              <div className="text-sm font-medium text-primary">{t("community.starTitle")}</div>
              <div className="text-xs text-muted mt-0.5">{t("community.starDesc")}</div>
            </div>
            <Star size={18} className="text-muted group-hover:text-yellow-400 transition-colors" />
          </button>

          {/* Discord */}
          <button
            onClick={() => openUrl(DISCORD_URL)}
            className="w-full flex items-center gap-4 p-4 bg-base border border-default rounded-lg hover:border-indigo-500/50 hover:bg-indigo-900/10 transition-all group cursor-pointer"
          >
            <div className="p-2.5 bg-surface-secondary rounded-lg group-hover:bg-indigo-900/20 transition-colors">
              <DiscordIcon size={22} className="text-secondary group-hover:text-indigo-400 transition-colors" />
            </div>
            <div className="text-left flex-1">
              <div className="text-sm font-medium text-primary">{t("community.discordTitle")}</div>
              <div className="text-xs text-muted mt-0.5">{t("community.discordDesc")}</div>
            </div>
          </button>

          {/* Other socials */}
          <SocialLinks
            iconSize={18}
            exclude={["GitHub", "Discord"]}
            className="justify-center"
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("community.dismiss")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
