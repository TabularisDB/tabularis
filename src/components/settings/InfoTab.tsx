import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import {
  Github,
  CheckCircle2,
  Circle,
  Heart,
  Info,
  Code2,
  Library,
  Download,
  Loader2,
  ExternalLink,
  Activity,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useUpdate } from "../../hooks/useUpdate";
import { useChangelog } from "../../hooks/useChangelog";
import { APP_VERSION } from "../../version";
import { ROADMAP } from "../../utils/settings";
import { SettingRow, SettingSection, SettingToggle } from "./SettingControls";
import { WhatsNewModal } from "../modals/WhatsNewModal";
import { OpenSourceLibrariesModal } from "../modals/OpenSourceLibrariesModal";

export function InfoTab() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const { currentTheme } = useTheme();
  const {
    checkForUpdates,
    isChecking,
    updateInfo,
    error: updateError,
    isUpToDate,
    installationSource,
  } = useUpdate();
  const {
    entries: changelogEntries,
    isLoading: isChangelogLoading,
  } = useChangelog();
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
  const [isOpenSourceLibrariesOpen, setIsOpenSourceLibrariesOpen] =
    useState(false);

  return (
    <div>
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-900/20 to-elevated border border-blue-500/20 rounded-2xl p-8 text-center relative overflow-hidden mb-8">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Code2 size={120} />
        </div>

        <div className="p-2">
          <img
            src="/logo.png"
            alt="tabularis"
            className="w-16 h-16 rounded-2xl mx-auto mb-4 shadow-lg shadow-blue-500/30"
            style={{
              backgroundColor: !currentTheme?.id?.includes("-light")
                ? currentTheme?.colors?.surface?.secondary || "#334155"
                : currentTheme?.colors?.bg?.elevated || "#f8fafc",
            }}
          />
        </div>

        <h1 className="text-3xl font-bold text-primary mb-2">tabularis</h1>
        <p className="text-secondary max-w-lg mx-auto mb-6">
          A lightweight, developer-focused database manager built with Tauri,
          Rust, and React. Born from a &quot;vibe coding&quot; experiment to
          create a modern, native tool in record time.
        </p>

        <div className="flex justify-center gap-4 flex-wrap">
          <button
            onClick={() => openUrl("https://github.com/debba/tabularis")}
            className="flex items-center gap-2 bg-surface-secondary hover:bg-surface-tertiary text-primary px-4 py-2 rounded-lg font-medium transition-colors border border-strong"
          >
            <Github size={18} />
            {t("settings.starOnGithub")}
          </button>
          <div className="flex items-center gap-2 bg-accent/10 text-accent px-4 py-2 rounded-lg border border-accent/30">
            <span className="text-xs font-bold uppercase tracking-wider">
              {t("settings.version")}
            </span>
            <span className="font-mono font-bold">
              {APP_VERSION} (Beta)
            </span>
          </div>
          <button
            onClick={() => setIsWhatsNewOpen(true)}
            className="flex items-center gap-2 bg-purple-900/20 hover:bg-purple-900/30 text-purple-400 px-4 py-2 rounded-lg font-medium transition-colors border border-purple-500/30"
          >
            <Sparkles size={18} />
            {t("whatsNew.title")}
          </button>
          <button
            onClick={() => setIsOpenSourceLibrariesOpen(true)}
            className="flex items-center gap-2 bg-blue-900/20 hover:bg-blue-900/30 text-blue-400 px-4 py-2 rounded-lg font-medium transition-colors border border-blue-500/30"
          >
            <Library size={18} />
            {t("settings.openSourceLibraries")}
          </button>
        </div>
      </div>

      {/* Updates */}
      <SettingSection
        title={t("settings.updates")}
        icon={<Download size={14} className="text-muted" />}
      >
        <div className="space-y-4 pt-3">
          <div className="bg-base p-4 rounded-lg border border-default">
            <div className="text-sm text-secondary">
              {t("settings.currentVersion")}
            </div>
            <div className="text-lg font-mono text-primary mt-1">
              v{APP_VERSION}
            </div>
          </div>

          {installationSource ? (
            <div className="bg-yellow-900/20 border border-yellow-900/50 text-yellow-400 px-4 py-3 rounded-lg">
              <div className="text-sm font-medium">
                {t("update.managedByPackageManager", {
                  source:
                    ({ aur: "AUR", snap: "Snap Store", flatpak: "Flathub" } as Record<string, string>)[
                      installationSource
                    ] ?? installationSource,
                })}
              </div>
              <div className="text-xs mt-1 text-yellow-400/70">
                {t("update.managedByPackageManagerDesc")}
              </div>
            </div>
          ) : (
            <>
              <SettingRow
                label={t("settings.autoCheckUpdates")}
                description={t("settings.autoCheckUpdatesDesc")}
              >
                <SettingToggle
                  checked={settings.autoCheckUpdatesOnStartup !== false}
                  onChange={(v) =>
                    updateSetting("autoCheckUpdatesOnStartup", v)
                  }
                />
              </SettingRow>

              <button
                onClick={() => checkForUpdates(true)}
                disabled={isChecking}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {isChecking ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t("settings.checking")}
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    {t("settings.checkNow")}
                  </>
                )}
              </button>

              {isUpToDate && !updateInfo && (
                <div className="bg-blue-900/20 border border-blue-900/50 text-blue-400 px-4 py-3 rounded-lg flex items-center gap-2">
                  <CheckCircle2 size={16} />
                  <span className="text-sm">{t("update.upToDate")}</span>
                </div>
              )}

              {updateInfo && (
                <div className="bg-green-900/20 border border-green-900/50 text-green-400 px-4 py-3 rounded-lg flex items-center gap-2">
                  <CheckCircle2 size={16} />
                  <span className="text-sm">
                    {t("update.updateAvailable", {
                      version: updateInfo.latestVersion,
                    })}
                  </span>
                </div>
              )}

              {updateError && (
                <div className="bg-red-900/20 border border-red-900/50 text-red-400 px-4 py-3 rounded-lg text-sm">
                  {updateError}
                </div>
              )}
            </>
          )}
        </div>
      </SettingSection>

      {/* Roadmap */}
      <SettingSection
        title={t("settings.projectStatus")}
        icon={<Info size={14} className="text-muted" />}
        description={t("settings.roadmapDesc")}
      >
        <div className="bg-elevated border border-default rounded-xl overflow-hidden mt-3">
          <div className="divide-y divide-default">
            {ROADMAP.map((item, i) => {
              const content = (
                <>
                  {item.done ? (
                    <CheckCircle2
                      size={18}
                      className="text-green-500 shrink-0"
                    />
                  ) : (
                    <Circle
                      size={18}
                      className="text-surface-tertiary shrink-0"
                    />
                  )}
                  <span
                    className={clsx(
                      "flex-1 text-left",
                      item.done ? "text-primary" : "text-muted",
                    )}
                  >
                    {item.label}
                  </span>
                  {item.url && (
                    <ExternalLink
                      size={14}
                      className="text-surface-tertiary opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  )}
                </>
              );

              if (item.url) {
                return (
                  <button
                    key={i}
                    onClick={() => openUrl(item.url!)}
                    className="w-full p-4 flex items-center gap-3 hover:bg-surface-secondary/30 transition-colors group cursor-pointer"
                  >
                    {content}
                  </button>
                );
              }

              return (
                <div
                  key={i}
                  className="p-4 flex items-center gap-3 hover:bg-surface-secondary/30 transition-colors group"
                >
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      </SettingSection>

      {/* Task Manager */}
      <SettingSection
        title={t("taskManager.header.title")}
        icon={<Activity size={14} className="text-muted" />}
        description={t("taskManager.header.description")}
        action={
          <button
            onClick={() => invoke("open_task_manager_window")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/15 border border-blue-500/25 text-blue-400 hover:bg-blue-500/25 transition-colors"
          >
            <Activity size={14} />
            {t("taskManager.header.open")}
          </button>
        }
      >
        <div />
      </SettingSection>

      {/* Support */}
      <SettingSection
        title={t("settings.support")}
        icon={<Heart size={14} className="text-muted" />}
        description={t("settings.supportDesc")}
      >
        <div className="pt-3 flex flex-col items-center text-center">
          <button
            onClick={() => openUrl("https://github.com/debba/tabularis")}
            className="text-blue-400 hover:text-blue-300 font-medium text-sm hover:underline"
          >
            github.com/debba/tabularis
          </button>
        </div>
      </SettingSection>

      <WhatsNewModal
        isOpen={isWhatsNewOpen}
        onClose={() => setIsWhatsNewOpen(false)}
        entries={changelogEntries}
        isLoading={isChangelogLoading}
      />

      <OpenSourceLibrariesModal
        isOpen={isOpenSourceLibrariesOpen}
        onClose={() => setIsOpenSourceLibrariesOpen(false)}
      />
    </div>
  );
}
