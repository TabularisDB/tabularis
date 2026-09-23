import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlatformCapabilities } from "../../hooks/usePlatformCapabilities";
import {
  Github,
  CheckCircle2,
  Circle,
  Heart,
  Info,
  Code2,
  Library,
  AlertTriangle,
  ArrowUpCircle,
  Download,
  Loader2,
  RefreshCw,
  ExternalLink,
  Activity,
  Sparkles,
  Share2,
} from "lucide-react";
import clsx from "clsx";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useUpdate } from "../../hooks/useUpdate";
import { useChangelog } from "../../hooks/useChangelog";
import { useSecondaryWindows } from "../../hooks/useSecondaryWindows";
import { APP_VERSION } from "../../version";
import { ROADMAP } from "../../utils/settings";
import {
  SettingButtonGroup,
  SettingRow,
  SettingSection,
  SettingToggle,
} from "./SettingControls";
import { WhatsNewModal } from "../modals/WhatsNewModal";
import { OpenSourceLibrariesModal } from "../modals/OpenSourceLibrariesModal";
import { SocialLinks } from "../SocialLinks";
import { TONE_SOFT_BG_CLASS, TONE_TEXT_CLASS, type Tone } from "../../utils/tones";

export function InfoTab() {
  const platform = usePlatformCapabilities();
  const { t } = useTranslation();
  const { openTaskManager } = useSecondaryWindows();
  const { settings, updateSetting } = useSettings();
  const { currentTheme } = useTheme();
  const {
    checkForUpdates,
    isChecking,
    availableUpdate: updateInfo,
    error: updateError,
    isUpToDate,
    installationSource,
    updaterMode,
    serverInfo,
    downloadAndInstall,
    isDownloading,
    downloadProgress,
  } = useUpdate();
  const isServerManaged = updaterMode === "server-managed";
  // One status for the card: what the user should know about updates right now.
  const updateStatus: { tone: Tone; Icon: typeof Download; line: string } = updateInfo
    ? { tone: "update", Icon: ArrowUpCircle, line: t("update.updateAvailable", { version: updateInfo.latestVersion }) }
    : updateError
      ? { tone: "danger", Icon: AlertTriangle, line: "" }
      : isUpToDate
        ? { tone: "success", Icon: CheckCircle2, line: t("update.upToDate") }
        : { tone: "neutral", Icon: Download, line: isChecking ? t("update.checkingForUpdates") : "" };
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
      <div className="bg-gradient-to-br from-accent-primary/10 to-elevated border border-accent-primary/20 rounded-2xl p-8 text-center relative overflow-hidden mb-8">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Code2 size={120} />
        </div>

        <div className="p-2">
          <img
            src="/logo.png"
            alt="tabularis"
            className="w-16 h-16 rounded-2xl mx-auto mb-4 shadow-lg shadow-accent-primary/30"
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
            onClick={() =>
              void platform.openExternalUrl("https://github.com/TabularisDB/tabularis")
            }
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
            className="flex items-center gap-2 bg-accent-secondary/10 hover:bg-accent-secondary/15 text-accent-secondary px-4 py-2 rounded-lg font-medium transition-colors border border-accent-secondary/30"
          >
            <Sparkles size={18} />
            {t("whatsNew.title")}
          </button>
          <button
            onClick={() => setIsOpenSourceLibrariesOpen(true)}
            className="flex items-center gap-2 bg-accent-primary/20 hover:bg-accent-primary/30 text-accent px-4 py-2 rounded-lg font-medium transition-colors border border-accent-primary/30"
          >
            <Library size={18} />
            {t("settings.openSourceLibraries")}
          </button>
        </div>
      </div>

      {/* Updates: one status card (version, state, actions) followed by the preferences. */}
      <SettingSection
        title={t("settings.updates")}
        icon={<Download size={14} className="text-muted" />}
      >
        <div className="space-y-4 pt-3">
          <div className="rounded-2xl border border-strong bg-elevated p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={clsx(
                    "p-2.5 rounded-lg shrink-0",
                    TONE_SOFT_BG_CLASS[updateStatus.tone],
                    updateStatus.tone === "neutral" ? "text-secondary" : TONE_TEXT_CLASS[updateStatus.tone],
                  )}
                >
                  {isChecking ? <Loader2 size={16} className="animate-spin" /> : <updateStatus.Icon size={16} />}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-muted">
                    {isServerManaged
                      ? t("update.serverVersion")
                      : t("settings.currentVersion")}
                  </div>
                  <div className="text-lg font-mono font-semibold text-primary leading-tight">
                    v{serverInfo?.version ?? APP_VERSION}
                  </div>
                  {updateStatus.line && (
                    <div
                      className={clsx(
                        "text-xs mt-0.5",
                        updateStatus.tone === "neutral" ? "text-muted" : TONE_TEXT_CLASS[updateStatus.tone],
                      )}
                    >
                      {updateStatus.line}
                    </div>
                  )}
                </div>
              </div>

              {!installationSource && !isServerManaged && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {updateInfo?.releaseUrl && (
                    <button
                      type="button"
                      onClick={() => void platform.openExternalUrl(updateInfo.releaseUrl)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-muted hover:text-primary hover:bg-surface-secondary/60 transition-colors"
                    >
                      <ExternalLink size={13} />
                      {t("update.releaseNotes")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => checkForUpdates(true)}
                    disabled={isChecking || isDownloading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-default bg-base text-xs text-secondary hover:text-primary hover:border-strong disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw size={13} className={clsx(isChecking && "animate-spin")} />
                    {isChecking ? t("settings.checking") : t("settings.checkNow")}
                  </button>
                  {updateInfo && (
                    <button
                      type="button"
                      onClick={() => downloadAndInstall()}
                      disabled={isDownloading}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-primary text-inverse text-xs font-semibold shadow-sm hover:bg-accent-primary/90 disabled:opacity-60 transition-colors"
                    >
                      {isDownloading ? (
                        <>
                          <Loader2 size={13} className="animate-spin" />
                          {t("update.downloading")} {Math.round(downloadProgress)}%
                        </>
                      ) : (
                        <>
                          <Download size={13} />
                          {t("update.downloadAndInstall")}
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
            {updateError && (
              <p className="mt-3 text-xs text-accent-error">{updateError}</p>
            )}
          </div>

          {isServerManaged ? (
            <div className="space-y-4">
              {serverInfo && (
                <div className="bg-base p-4 rounded-lg border border-default">
                  <div className="text-sm text-secondary">
                    {t("update.serverBuild")}
                  </div>
                  <div className="text-sm font-mono text-primary mt-1 break-all">
                    {[
                      serverInfo.build.target,
                      serverInfo.build.profile,
                      serverInfo.build.commit,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              )}
              <div className="bg-accent-primary/10 border border-accent-primary/30 text-accent px-4 py-4 rounded-lg">
                <div className="text-sm font-medium">
                  {t("update.serverManagedTitle")}
                </div>
                <div className="text-xs mt-1 text-accent/80">
                  {t("update.serverManagedDesc")}
                </div>
                <button
                  onClick={() =>
                    void platform.openExternalUrl(
                      "https://github.com/TabularisDB/tabularis/blob/main/web-ui-project/docs/WEB_MODE_UPGRADES.md",
                    )
                  }
                  className="mt-3 flex items-center gap-2 text-sm font-medium text-accent hover:text-accent/90 hover:underline"
                >
                  <ExternalLink size={14} />
                  {t("update.openServerUpgradeGuide")}
                </button>
              </div>
            </div>
          ) : installationSource ? (
            <div className="bg-accent-warning/10 border border-accent-warning/30 px-4 py-3 rounded-lg">
              <div className="text-sm font-medium text-accent-warning">
                {t("update.managedByPackageManager", {
                  source:
                    ({ aur: "AUR", snap: "Snap Store", flatpak: "Flathub" } as Record<string, string>)[
                      installationSource
                    ] ?? installationSource,
                })}
              </div>
              <div className="text-xs mt-1 text-accent-warning/70">
                {t("update.managedByPackageManagerDesc")}
              </div>
            </div>
          ) : (
            <>
              <SettingRow
                label={t("settings.releaseChannel")}
                description={t("settings.releaseChannelDesc")}
              >
                <SettingButtonGroup
                  value={settings.releaseChannel ?? "stable"}
                  onChange={(v) => updateSetting("releaseChannel", v)}
                  options={[
                    { value: "stable", label: t("settings.channelStable") },
                    { value: "nightly", label: t("settings.channelNightly") },
                  ]}
                />
              </SettingRow>

              {settings.releaseChannel === "nightly" && (
                <div className="bg-accent-warning/10 border border-accent-warning/30 text-accent-warning px-4 py-3 rounded-lg text-xs">
                  {t("update.nightlyWarning")}
                </div>
              )}

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
                      className="text-accent-success shrink-0"
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
                    onClick={() => void platform.openExternalUrl(item.url!)}
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
            onClick={() => void openTaskManager()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent-primary/15 border border-accent-primary/25 text-accent hover:bg-accent-primary/25 transition-colors"
          >
            <Activity size={14} />
            {t("taskManager.header.open")}
          </button>
        }
      >
        <div />
      </SettingSection>

      {/* Follow us */}
      <SettingSection
        title={t("settings.followUs")}
        icon={<Share2 size={14} className="text-muted" />}
        description={t("settings.followUsDesc")}
      >
        <div className="pt-3">
          <SocialLinks showLabels />
        </div>
      </SettingSection>

      {/* Support */}
      <SettingSection
        title={t("settings.support")}
        icon={<Heart size={14} className="text-muted" />}
        description={t("settings.supportDesc")}
      >
        <div className="pt-3 flex flex-col items-center text-center">
          <button
            onClick={() =>
              void platform.openExternalUrl("https://github.com/TabularisDB/tabularis")
            }
            className="text-accent hover:text-accent/90 font-medium text-sm hover:underline"
          >
            github.com/TabularisDB/tabularis
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
