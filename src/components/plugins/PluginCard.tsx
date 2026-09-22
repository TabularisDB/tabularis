import type { ReactNode } from "react";
import { BookOpen, Check, Download, ExternalLink, Home, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PluginManifest } from "../../types/plugins";
import { getDriverColor, getDriverIcon } from "../../utils/driverUI";
import { parseAuthor, type PluginKind } from "../../utils/plugins";
import { CARD_RESTING_CLASS } from "../../utils/connections";
import { formatCount, stripTrailingSlash, THEME_TILE_COLOR } from "../../utils/pluginPresentation";
import { RegistryDriverIcon } from "../RegistryDriverIcon";
import { Chip } from "../ui/Chip";
import { CompactCard, CompactCardHeader, CompactCardFooter } from "../ui/CompactCard";
import { PluginKindChip } from "./PluginKindChip";
import { PluginUpdateIndicator } from "./PluginUpdateIndicator";
import { UpdateTooltip } from "../ui/UpdateTooltip";

/** Footer icon buttons mirror the connection card's action row. */
export const PLUGIN_ICON_BUTTON_CLASS =
  "p-1.5 rounded-lg text-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:text-accent hover:bg-accent-primary/10";

interface PluginCardProps {
  /** Driver (executable) or theme (declarative); drives the icon tile and the kind chip. */
  kind?: PluginKind;
  name: string;
  description: string;
  version?: string;
  manifest?: PluginManifest;
  author?: string;
  homepage?: string;
  registryPageUrl?: string | null;
  iconUrl?: string | null;
  downloads?: number | null;
  /** Informational badges, kept in the same row as the version. */
  status?: ReactNode;
  /** Enable/disable control; separate from informational badges. */
  control?: ReactNode;
  /** Low-emphasis taxonomy (kind, tags), rendered on its own row under the description. */
  meta?: ReactNode;
  /** Primary action area (install/update button, version picker): footer left. */
  actions?: ReactNode;
  /** Icon buttons (settings, remove, plugin slots): footer right, after the built-in links. */
  secondaryActions?: ReactNode;
  /** Installed release matches the registry's latest: shows a success chip. */
  upToDate?: boolean;
  /** Latest installable version when an update is pending; hides the pill when absent. */
  updateVersion?: string | null;
  onShowReadme?: () => void;
}

/**
 * One card layout for every plugin list (All, Installed, Updates):
 * identity on top, a single status row (version, installed/built-in,
 * up to date or pending update), description, taxonomy, then a footer with
 * the primary action on the left and icon buttons on the right.
 */
export function PluginCard({
  kind = "driver", name, description, version, manifest, author, homepage, registryPageUrl,
  iconUrl, downloads, status, control, meta, actions, secondaryActions, upToDate, updateVersion, onShowReadme,
}: PluginCardProps) {
  const { t } = useTranslation();
  const parsedAuthor = author ? parseAuthor(author) : null;
  const primaryHref = registryPageUrl ?? homepage ?? null;
  const secondaryHomepage = homepage && registryPageUrl &&
    stripTrailingSlash(homepage) !== stripTrailingSlash(registryPageUrl)
    ? homepage : null;
  const isTheme = kind === "theme";
  // Themes get a fixed palette tile: they never carry a driver manifest colour.
  const fallbackIcon = isTheme ? <Palette size={20} /> : getDriverIcon(manifest, 20);
  const icon = (!isTheme && manifest?.icon) || !iconUrl
    ? fallbackIcon
    : <RegistryDriverIcon key={iconUrl} src={iconUrl} size={20} fallback={fallbackIcon} />;
  const iconColor = isTheme ? THEME_TILE_COLOR : getDriverColor(manifest);
  const updateLabel = t(isTheme ? "update.badges.themeUpdate" : "update.badges.driverUpdate");
  const hasFooter = !!(actions || secondaryActions || secondaryHomepage || onShowReadme);

  return (
    <CompactCard className={clsx("h-full", CARD_RESTING_CLASS)}>
      <CompactCardHeader icon={icon} iconColor={iconColor}>
        <div className="flex items-start justify-between gap-2 mb-1.5">
          {primaryHref ? (
            <button
              type="button"
              onClick={() => openUrl(primaryHref)}
              aria-label={`${name} — ${primaryHref}`}
              className="inline-flex min-w-0 items-center gap-1.5 text-left font-bold text-sm text-primary leading-snug hover:text-accent"
            >
              <span className="truncate">{name}</span>
              <ExternalLink size={12} className="shrink-0 text-muted" />
            </button>
          ) : (
            <span className="font-bold text-sm text-primary leading-snug truncate">{name}</span>
          )}
          {control && <div className="shrink-0">{control}</div>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <PluginKindChip kind={kind} />
            {version && <Chip>v{version}</Chip>}
            {status}
            {upToDate && (
              <Chip tone="success" icon={<Check size={9} aria-hidden="true" />}>
                {t("settings.plugins.upToDate")}
              </Chip>
            )}
            {updateVersion && (
              <UpdateTooltip label={updateLabel}>
                <span
                  role="img"
                  aria-label={updateLabel}
                  className="inline-flex rounded-full"
                >
                  <PluginUpdateIndicator version={updateVersion} />
                </span>
              </UpdateTooltip>
            )}
        </div>
        <p className="text-[11px] text-muted line-clamp-2 break-words">{description}</p>
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-1">{meta}</div>}
        {(parsedAuthor || !!downloads) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-muted">
            {parsedAuthor && (
              <span>
                {t("settings.plugins.by")}{" "}
                {parsedAuthor.url ?? homepage ? (
                  <button
                    type="button"
                    onClick={() => openUrl((parsedAuthor.url ?? homepage)!)}
                    className="underline-offset-2 hover:text-secondary hover:underline"
                  >
                    {parsedAuthor.name}
                  </button>
                ) : parsedAuthor.name}
              </span>
            )}
            {!!downloads && downloads > 0 && (
              <span className="inline-flex items-center gap-1" title={t("update.downloads")}>
                <Download size={10} aria-hidden="true" />
                {formatCount(downloads)}
              </span>
            )}
          </div>
        )}
      </CompactCardHeader>
      {hasFooter && (
        <CompactCardFooter className="gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{actions}</div>
          <div className="flex shrink-0 items-center gap-0.5">
            {onShowReadme && (
              <button
                type="button"
                onClick={onShowReadme}
                title={t("connectionCatalogue.viewDetails", { defaultValue: "More details" })}
                aria-label={t("connectionCatalogue.viewDetails", { defaultValue: "More details" })}
                className={PLUGIN_ICON_BUTTON_CLASS}
              >
                <BookOpen size={14} />
              </button>
            )}
            {secondaryHomepage && (
              <button
                type="button"
                onClick={() => openUrl(secondaryHomepage)}
                title={t("settings.plugins.openHomepage", { defaultValue: "Open homepage" })}
                aria-label={t("settings.plugins.openHomepage", { defaultValue: "Open homepage" })}
                className={PLUGIN_ICON_BUTTON_CLASS}
              >
                <Home size={14} />
              </button>
            )}
            {secondaryActions}
          </div>
        </CompactCardFooter>
      )}
    </CompactCard>
  );
}
