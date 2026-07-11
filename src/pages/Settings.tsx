import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Settings as SettingsIcon,
  Palette,
  Languages,
  Sparkles,
  ScrollText,
  Keyboard,
  Plug,
  Info,
  FileJson,
  Shield,
  Cable,
} from "lucide-react";
import clsx from "clsx";
import { ConfigJsonModal } from "../components/modals/ConfigJsonModal";
import { GeneralTab } from "../components/settings/GeneralTab";
import { AppearanceTab } from "../components/settings/AppearanceTab";
import { LocalizationTab } from "../components/settings/LocalizationTab";
import { AiTab } from "../components/settings/AiTab";
import { LogsTab } from "../components/settings/LogsTab";
import { ShortcutsTab } from "../components/settings/ShortcutsTab";
import { PluginsTab } from "../components/settings/PluginsTab";
import { SshTab } from "../components/settings/SshTab";
import { AiActivityPanel } from "../components/settings/AiActivityPanel";
import { InfoTab } from "../components/settings/InfoTab";
import { PluginSettingsPage } from "../components/settings/PluginSettingsPage";
import { useDrivers } from "../hooks/useDrivers";
import { useSettings } from "../hooks/useSettings";

type SettingsTab =
  | "general"
  | "ssh"
  | "appearance"
  | "localization"
  | "ai"
  | "ai-activity"
  | "logs"
  | "shortcuts"
  | "plugins"
  | "info"
  | `plugin:${string}`;

interface PluginSidebarChange {
  type: "install" | "remove";
  pluginId: string;
  pluginName?: string;
}

const TAB_ITEMS: Array<{
  id: SettingsTab;
  icon: React.ComponentType<{ size: number }>;
  labelKey: string;
}> = [
  { id: "general", icon: SettingsIcon, labelKey: "settings.general" },
  { id: "ssh", icon: Cable, labelKey: "sshConnections.title" },
  { id: "plugins", icon: Plug, labelKey: "settings.plugins.title" },
  { id: "appearance", icon: Palette, labelKey: "settings.appearance" },
  { id: "localization", icon: Languages, labelKey: "settings.localization" },
  { id: "ai", icon: Sparkles, labelKey: "settings.ai.tab" },
  { id: "ai-activity", icon: Shield, labelKey: "settings.aiActivity" },
  { id: "logs", icon: ScrollText, labelKey: "settings.logs" },
  { id: "shortcuts", icon: Keyboard, labelKey: "settings.shortcuts.title" },
  { id: "info", icon: Info, labelKey: "settings.info" },
];

const TAB_COMPONENTS: Partial<Record<SettingsTab, React.ComponentType>> = {
  general: GeneralTab,
  ssh: SshTab,
  appearance: AppearanceTab,
  localization: LocalizationTab,
  ai: AiTab,
  "ai-activity": AiActivityPanel,
  logs: LogsTab,
  shortcuts: ShortcutsTab,
  plugins: PluginsTab,
  info: InfoTab,
};

export const Settings = () => {
  const { t } = useTranslation();
  const {
    allDrivers,
    installedPlugins,
    refresh: refreshDrivers,
  } = useDrivers();
  const { settings } = useSettings();
  const activeExternalDrivers =
    settings.activeExternalDrivers ?? installedPlugins.map((p) => p.id);
  const [requestedTab, setRequestedTab] = useState<SettingsTab>("general");
  const [isConfigJsonModalOpen, setIsConfigJsonModalOpen] = useState(false);
  const [pluginSidebarOverrides, setPluginSidebarOverrides] = useState<
    Record<string, string | null>
  >({});

  const handlePluginsChanged = useCallback(
    (change: PluginSidebarChange) => {
      setPluginSidebarOverrides((prev) => {
        const next = { ...prev };
        if (change.type === "install") {
          next[change.pluginId] = change.pluginName ?? change.pluginId;
        } else {
          next[change.pluginId] = null;
        }
        return next;
      });
      refreshDrivers();
    },
    [refreshDrivers],
  );

  const pluginSettingItems = new Map<string, { id: string; name: string }>();

  for (const driver of allDrivers) {
    const hasSettings = (driver.settings?.length ?? 0) > 0;
    if (driver.is_builtin && !hasSettings) continue;
    if (!driver.is_builtin && !activeExternalDrivers.includes(driver.id))
      continue;
    pluginSettingItems.set(driver.id, {
      id: driver.id,
      name: driver.name,
    });
  }

  for (const plugin of installedPlugins) {
    if (pluginSidebarOverrides[plugin.id] === null) continue;
    if (!activeExternalDrivers.includes(plugin.id)) continue;
    pluginSettingItems.set(plugin.id, {
      id: plugin.id,
      name: plugin.name,
    });
  }

  for (const [pluginId, pluginName] of Object.entries(pluginSidebarOverrides)) {
    if (
      pluginName !== null &&
      !installedPlugins.some((plugin) => plugin.id === pluginId) &&
      activeExternalDrivers.includes(pluginId)
    ) {
      pluginSettingItems.set(pluginId, {
        id: pluginId,
        name: pluginName,
      });
    }
  }

  const pluginTabs = Array.from(pluginSettingItems.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const isRequestedPluginTab = requestedTab.startsWith("plugin:");
  const requestedPluginId = isRequestedPluginTab
    ? requestedTab.slice("plugin:".length)
    : null;
  const hasRequestedPluginTab =
    requestedPluginId !== null &&
    pluginTabs.some((plugin) => plugin.id === requestedPluginId);
  const activeTab =
    isRequestedPluginTab && !hasRequestedPluginTab
      ? "plugins"
      : requestedTab;
  const ActiveComponent = TAB_COMPONENTS[activeTab];
  const activePluginId = activeTab.startsWith("plugin:")
    ? activeTab.slice("plugin:".length)
    : null;

  return (
    <div className="h-full flex bg-base">
      {/* Sidebar */}
      <nav className="w-52 flex flex-col border-r border-default bg-elevated shrink-0">
        <div className="flex-1 py-2 px-2 overflow-y-auto space-y-0.5">
          {TAB_ITEMS.map(({ id, icon: Icon, labelKey }) => (
            <div key={id} className="space-y-1">
              <button
                onClick={() => setRequestedTab(id)}
                className={clsx(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left",
                  activeTab === id ||
                    (id === "plugins" && activePluginId !== null)
                    ? "bg-surface-secondary text-primary"
                    : "text-muted hover:text-primary hover:bg-surface-secondary/50",
                )}
              >
                <Icon size={16} />
                <span className="truncate">{t(labelKey)}</span>
                {id === "plugins" && pluginTabs.length > 0 && (
                  <span className="ml-auto rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-400 border border-blue-500/20">
                    {pluginTabs.length}
                  </span>
                )}
              </button>

              {id === "plugins" && pluginTabs.length > 0 && (
                <div className="pl-4 space-y-0.5">
                  {pluginTabs.map((plugin) => {
                    const pluginTabId = `plugin:${plugin.id}` as const;
                    return (
                      <button
                        key={plugin.id}
                        onClick={() => setRequestedTab(pluginTabId)}
                        className={clsx(
                          "w-full px-3 py-1.5 rounded-lg text-xs text-left transition-colors truncate",
                          activeTab === pluginTabId
                            ? "bg-surface-secondary text-primary"
                            : "text-muted hover:text-primary hover:bg-surface-secondary/50",
                        )}
                        title={plugin.name}
                      >
                        {plugin.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Config JSON button */}
        <div className="p-2 border-t border-default">
          <button
            onClick={() => setIsConfigJsonModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted hover:text-primary hover:bg-surface-secondary/50 transition-colors"
          >
            <FileJson size={14} />
            {t("settings.editConfigJson")}
          </button>
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-8">
          {activePluginId ? (
            <PluginSettingsPage
              key={activePluginId}
              pluginId={activePluginId}
            />
          ) : activeTab === "plugins" ? (
            <PluginsTab
              onOpenPluginSettings={(pluginId) =>
                setRequestedTab(`plugin:${pluginId}`)
              }
              onPluginsChanged={handlePluginsChanged}
            />
          ) : (
            ActiveComponent && <ActiveComponent />
          )}
        </div>
      </div>

      <ConfigJsonModal
        isOpen={isConfigJsonModalOpen}
        onClose={() => setIsConfigJsonModalOpen(false)}
      />
    </div>
  );
};
