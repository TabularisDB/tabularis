import { useEffect, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ExternalLink, Info, Loader2, Palette } from "lucide-react";
import { ThemeDialog } from "../ui/ThemeDialog";
import { ThemeDialogButton } from "../ui/ThemeDialogButton";
import { InlineBanner } from "../ui/InlineBanner";
import type { PluginReadme } from "../../types/plugins";
import type { ThemeRegistryPlugin } from "../../utils/themeDiscovery";
import { safeThemeExternalUrl, themeReadmeHtml } from "../../utils/themeReadme";
import { toRegistryLocale } from "../../i18n/registryLocale";

interface Props { plugin: ThemeRegistryPlugin; registryUrl: string; onClose: () => void }

export function ThemeReadmeModal({ plugin, registryUrl, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const locale = toRegistryLocale(i18n.resolvedLanguage ?? i18n.language ?? "en");
  const [readme, setReadme] = useState<{ html: string; data: PluginReadme }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void invoke<PluginReadme>("fetch_plugin_readme", { slug: plugin.id, locale, registryUrl }).then((data) => {
      if (!disposed) setReadme({ data, html: themeReadmeHtml(data.html ?? "", data.repo_url ?? null) });
    }).catch((failure) => { if (!disposed) setError(String(failure)); });
    return () => { disposed = true; };
  }, [plugin.id, registryUrl, locale]);
  const open = (url: string) => { void openUrl(url).catch((failure) => setError(String(failure))); };
  const link = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    event.preventDefault();
    const url = safeThemeExternalUrl(anchor.getAttribute("href"));
    if (url) open(url);
  };
  const docs = safeThemeExternalUrl(readme?.data.documentation_url);
  const screenshots = (plugin.screenshots ?? []).flatMap((image) => {
    const url = safeThemeExternalUrl(image.url); return url ? [{ ...image, url }] : [];
  });
  return <ThemeDialog isOpen onClose={onClose} icon={<Palette size={20} />} title={plugin.name} subtitle={t("themePackages.readme")} widthClass="w-[760px]"
    footer={<>
      {docs && <ThemeDialogButton className="mr-auto" icon={<ExternalLink size={16} />} onClick={() => open(docs)}>{t("connectionCatalogue.openDocumentation")}</ThemeDialogButton>}
      <ThemeDialogButton onClick={onClose}>{t("common.close")}</ThemeDialogButton>
    </>}>
    <InlineBanner tone="neutral" icon={<Info size={16} />}>{t("themePackages.externalMedia")}</InlineBanner>
    {screenshots.length > 0 && <section aria-label={t("themePackages.screenshots")} className="space-y-2"><h3 className="text-sm font-semibold">{t("themePackages.screenshots")}</h3><ul className="space-y-2">{screenshots.map((image, index) => <li key={`${image.url}:${index}`}><button type="button" onClick={() => open(image.url)} className="inline-flex items-center gap-2 text-sm text-accent underline text-left break-words rounded focus-visible:outline focus-visible:outline-focus"><ExternalLink size={14} className="shrink-0" /><span>{image.caption?.trim() || image.alt?.trim() || `${t("themePackages.screenshots")} ${index + 1}`}</span></button></li>)}</ul></section>}
    {!readme && !error && <InlineBanner tone="neutral" role="status" icon={<Loader2 size={16} className="animate-spin" />}>{t("themePackages.loading")}</InlineBanner>}
    {readme?.data.locale && readme.data.locale !== locale && <p className="text-xs text-muted">{readme.data.locale}</p>}
    {/* Delegates clicks from the README's <a> elements, which stay focusable and fire click on Enter. */}
    {readme?.html ? <div role="presentation" onClick={link} onAuxClick={link} className="text-sm leading-relaxed break-words [&_h1]:text-lg [&_h2]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h2]:mt-4 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:bg-base [&_a]:text-accent [&_a]:underline" dangerouslySetInnerHTML={{ __html: readme.html }} /> : readme && <p>{t("connectionCatalogue.readmeUnavailable")}</p>}
    {error && <InlineBanner tone="red" role="alert" icon={<AlertTriangle size={16} />}><p className="whitespace-pre-wrap break-words">{error}</p></InlineBanner>}
  </ThemeDialog>;
}
