import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import Editor from "@monaco-editor/react";
import {
  Activity,
  Check,
  Copy,
  Cpu,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import {
  AnthropicIcon,
  AntigravityIcon,
  CursorIcon,
  WindsurfIcon,
} from "../components/icons/ClientIcons";
import { AiActivityPanel } from "../components/settings/AiActivityPanel";
import { McpSafetySection } from "../components/modals/mcp/McpSafetySection";
import { useAlert } from "../hooks/useAlert";
import { useTheme } from "../hooks/useTheme";
import { loadMonacoTheme } from "../themes/themeUtils";

interface McpClientStatus {
  client_id: string;
  client_name: string;
  installed: boolean;
  config_path: string | null;
  executable_path: string;
  client_type: string;
}

type McpPageTab = "setup" | "activity" | "safety";

const ClientIcon = ({
  clientId,
  size = 20,
}: {
  clientId: string;
  size?: number;
}) => {
  switch (clientId) {
    case "claude":
    case "claude_code":
      return <AnthropicIcon size={size} />;
    case "cursor":
      return <CursorIcon size={size} className="text-white" />;
    case "windsurf":
      return <WindsurfIcon size={size} className="text-white" />;
    case "antigravity":
      return <AntigravityIcon size={size} />;
    default:
      return <Cpu size={size} />;
  }
};

export function McpPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<McpPageTab>("setup");

  const tabs: Array<{
    id: McpPageTab;
    icon: React.ComponentType<{ size: number }>;
    label: string;
  }> = [
    { id: "setup", icon: Cpu, label: t("mcp.tabs.setup") },
    { id: "activity", icon: Activity, label: t("mcp.tabs.activity") },
    { id: "safety", icon: ShieldCheck, label: t("mcp.tabs.safety") },
  ];

  return (
    <div className="h-full overflow-auto bg-base">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
        <header className="flex flex-col gap-3 border-b border-default pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-900/30 text-purple-400">
              <Cpu size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-primary">
                {t("mcp.title")}
              </h1>
              <p className="mt-1 text-sm text-muted">{t("mcp.subtitle")}</p>
            </div>
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-secondary">
            {t("mcp.description")}
          </p>
        </header>

        <div className="flex gap-1 border-b border-default">
          {tabs.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={clsx(
                "-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                tab === id
                  ? "border-blue-500 text-primary"
                  : "border-transparent text-muted hover:text-primary",
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {tab === "setup" && <McpSetupPanel />}
        {tab === "activity" && <AiActivityPanel />}
        {tab === "safety" && (
          <div className="max-w-4xl">
            <McpSafetySection />
          </div>
        )}
      </div>
    </div>
  );
}

function McpSetupPanel() {
  const { t } = useTranslation();
  const { currentTheme } = useTheme();
  const { showAlert } = useAlert();
  const [clients, setClients] = useState<McpClientStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const selectedClient = useMemo(
    () =>
      clients.find((client) => client.client_id === selectedClientId) ??
      clients[0] ??
      null,
    [clients, selectedClientId],
  );

  const jsonValue = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            tabularis: {
              command: selectedClient?.executable_path || "tabularis",
              args: ["--mcp"],
            },
          },
        },
        null,
        2,
      ),
    [selectedClient?.executable_path],
  );

  const cliCommand = useMemo(
    () =>
      `claude mcp add --scope user tabularis ${
        selectedClient?.executable_path || "tabularis"
      } -- --mcp`,
    [selectedClient?.executable_path],
  );

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await invoke<McpClientStatus[]>("get_mcp_status");
      setClients(res);
      setSelectedClientId((current) => current ?? res[0]?.client_id ?? null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleInstall = async (clientId: string) => {
    try {
      const clientName = await invoke<string>("install_mcp_config", {
        clientId,
      });
      showAlert(t("mcp.successMsg", { client: clientName }), {
        kind: "info",
        title: t("mcp.successTitle"),
      });
      await loadStatus();
    } catch (e) {
      showAlert(String(e), { kind: "error", title: t("mcp.errorTitle") });
    }
  };

  const isCommandClient = selectedClient?.client_type === "command";

  if (loading) {
    return (
      <div className="rounded-lg border border-default bg-surface-secondary/25 py-12 text-center text-sm text-muted">
        {t("mcp.checking")}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase text-muted">
          {t("mcp.clients")}
        </h2>
        <div className="space-y-2">
          {clients.map((client) => (
            <button
              key={client.client_id}
              onClick={() => setSelectedClientId(client.client_id)}
              className={clsx(
                "flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors",
                selectedClient?.client_id === client.client_id
                  ? "border-purple-500/50 bg-purple-900/10"
                  : "border-default bg-base hover:border-strong",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                  <ClientIcon clientId={client.client_id} size={22} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <span className="truncate">{client.client_name}</span>
                    {client.client_type === "command" && (
                      <Terminal size={11} className="shrink-0 text-muted" />
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-muted">
                    {client.config_path ?? t("mcp.notFound")}
                  </div>
                </div>
              </div>
              {client.installed ? (
                <div className="ml-3 flex shrink-0 items-center gap-2 rounded-full border border-green-900/50 bg-green-900/20 px-3 py-1 text-xs font-medium text-green-400">
                  <Check size={12} />
                  <span>{t("mcp.installed")}</span>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleInstall(client.client_id);
                  }}
                  className="ml-3 shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-blue-900/20 transition-colors hover:bg-blue-500"
                >
                  {t("mcp.install")}
                </button>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="min-w-0 space-y-2">
        {selectedClient && !selectedClient.installed ? (
          <>
            <h2 className="text-xs font-bold uppercase text-muted">
              {isCommandClient ? t("mcp.manualCommand") : t("mcp.manualConfig")}
              {" - "}
              {selectedClient.client_name}
            </h2>
            {isCommandClient ? (
              <div className="group relative">
                <div className="rounded-lg border border-default bg-base p-3 pr-10 font-mono text-xs text-secondary break-all">
                  {cliCommand}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(cliCommand);
                    setCopiedCmd(true);
                    setTimeout(() => setCopiedCmd(false), 2000);
                  }}
                  className="absolute right-2 top-2 rounded bg-surface-secondary p-1.5 text-secondary opacity-0 transition-all hover:text-primary group-hover:opacity-100"
                >
                  {copiedCmd ? (
                    <Check size={13} className="text-green-400" />
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>
            ) : (
              <div className="group relative overflow-hidden rounded-lg border border-default">
                <Editor
                  height="220px"
                  defaultLanguage="json"
                  theme={currentTheme.id}
                  value={jsonValue}
                  beforeMount={(monaco) => loadMonacoTheme(currentTheme, monaco)}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    lineNumbers: "off",
                    scrollBeyondLastLine: false,
                    folding: false,
                    domReadOnly: true,
                    contextmenu: false,
                    fontSize: 12,
                    padding: { top: 12, bottom: 12 },
                    wordWrap: "on",
                  }}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(jsonValue);
                    setCopiedJson(true);
                    setTimeout(() => setCopiedJson(false), 2000);
                  }}
                  className="absolute right-2 top-2 z-10 rounded bg-surface-secondary p-2 text-secondary opacity-0 transition-all hover:text-primary group-hover:opacity-100"
                >
                  {copiedJson ? (
                    <Check size={14} className="text-green-400" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            )}
            <p className="text-xs text-muted">
              {isCommandClient ? t("mcp.manualCommandText") : t("mcp.manualText")}
            </p>
          </>
        ) : (
          <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-default bg-surface-secondary/20 p-6 text-center text-sm text-muted">
            {t("mcp.installed")}
          </div>
        )}
      </section>
    </div>
  );
}
