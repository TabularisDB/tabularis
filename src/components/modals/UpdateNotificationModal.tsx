import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { X, Download, ExternalLink, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SocialLinks } from "../SocialLinks";
import Markdown from "react-markdown";

interface UpdateNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: {
    currentVersion: string;
    latestVersion: string;
    releaseNotes: string;
    releaseUrl: string;
    publishedAt: string;
    downloadUrls: Array<{
      name: string;
      url: string;
      size: number;
      platform: string;
    }>;
  } | null;
  isDownloading: boolean;
  downloadProgress: number;
  onDownloadAndInstall: () => void;
  error: string | null;
}

export const UpdateNotificationModal = ({
  isOpen,
  onClose,
  updateInfo,
  isDownloading,
  downloadProgress,
  onDownloadAndInstall,
  error
}: UpdateNotificationModalProps) => {
  const { t } = useTranslation();

  if (!updateInfo) return null;

  const handleViewRelease = async () => {
    await openUrl(updateInfo.releaseUrl);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-900/30 rounded-lg">
              <Download size={20} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("update.newVersionAvailable")}
              </h2>
              <p className="text-xs text-secondary">
                v{updateInfo.currentVersion} → v{updateInfo.latestVersion}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isDownloading}
            className="p-2 text-secondary hover:text-primary hover:bg-surface-tertiary rounded-lg transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">

          {/* Release Info */}
          <div className="bg-surface-secondary/50 p-4 rounded-lg border border-strong">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={16} className="text-green-400" />
              <span className="text-sm font-medium text-primary">
                {t("update.version")} {updateInfo.latestVersion}
              </span>
              <span className="text-xs text-muted">
                • {new Date(updateInfo.publishedAt).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Download Progress */}
          {isDownloading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-secondary">
                  {downloadProgress < 100 ? t("update.downloading") : t("update.installing")}
                </span>
                <span className="text-primary font-medium">{downloadProgress}%</span>
              </div>
              <div className="w-full h-2 bg-base rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              {downloadProgress === 100 && (
                <p className="text-xs text-muted text-center">
                  {t("update.installingMessage")}
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-error-bg border border-error-border text-error-text px-4 py-3 rounded flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">{t("update.error")}</div>
                <div className="text-xs mt-1">{error}</div>
              </div>
            </div>
          )}

          {/* Release Notes */}
          <div>
            <label className="text-xs uppercase font-bold text-muted mb-2 block">
              {t("update.releaseNotes")}
            </label>
            <div className="bg-base border border-default rounded-lg p-4 max-h-[300px] overflow-y-auto">
              <div
                className={
                  "text-sm text-secondary leading-relaxed " +
                  "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:text-primary " +
                  "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:text-primary " +
                  "[&_h3]:text-base [&_h3]:font-medium [&_h3]:mb-1 [&_h3]:text-primary " +
                  "[&_p]:mb-2 [&_code]:bg-surface-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono " +
                  "[&_pre]:bg-surface-secondary [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:mb-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
                  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:mb-1 " +
                  "[&_a]:text-blue-400 [&_a]:underline [&_a]:cursor-pointer [&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted " +
                  "[&_hr]:border-default [&_hr]:my-4 [&_strong]:font-semibold [&_strong]:text-primary [&_em]:italic"
                }
              >
                <Markdown
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        onClick={(event) => {
                          event.preventDefault();
                          if (href) void openUrl(href);
                        }}
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {updateInfo.releaseNotes}
                </Markdown>
              </div>
            </div>
          </div>

          {/* Follow us */}
          <div>
            <label className="text-xs uppercase font-bold text-muted mb-2 block">
              {t("settings.followUs")}
            </label>
            <SocialLinks iconSize={18} />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-between">
          <button
            onClick={handleViewRelease}
            disabled={isDownloading}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <ExternalLink size={16} />
            {t("update.viewOnGitHub")}
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isDownloading}
              className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm disabled:opacity-50"
            >
              {t("update.remindLater")}
            </button>
            <button
              onClick={onDownloadAndInstall}
              disabled={isDownloading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              {isDownloading && <Loader2 size={16} className="animate-spin" />}
              {isDownloading ? t("update.downloading") : t("update.downloadAndInstall")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
