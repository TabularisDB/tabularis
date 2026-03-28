import { useCallback, useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { X, Check, Copy, Cpu, Terminal } from "lucide-react";
import { useAlert } from "../../hooks/useAlert";
import Editor from "@monaco-editor/react";
import { useTheme } from "../../hooks/useTheme";
import { loadMonacoTheme } from "../../themes/themeUtils";
import { Modal } from "../ui/Modal";
import {
  AnthropicIcon,
  CursorIcon,
  WindsurfIcon,
  AntigravityIcon,
} from "../icons/ClientIcons";

interface McpClientStatus {
  client_id: string;
  client_name: string;
  installed: boolean;
  config_path: string | null;
  executable_path: string;
  client_type: string; // "file" | "command"
}

interface McpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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

export const McpModal = ({ isOpen, onClose }: McpModalProps) => {
  const { t } = useTranslation();
  const { currentTheme } = useTheme();
  const { showAlert } = useAlert();
  const [clients, setClients] = useState<McpClientStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [selectedClient, setSelectedClient] = useState<McpClientStatus | null>(null);

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
        2
      ),
    [selectedClient?.executable_path]
  );

  const cliCommand = useMemo(
    () =>
      `claude mcp add --scope user tabularis ${selectedClient?.executable_path || "tabularis"} -- --mcp`,
    [selectedClient?.executable_path]
  );

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await invoke<McpClientStatus[]>("get_mcp_status");
      setClients(res);
      if (!selectedClient && res.length > 0) {
        setSelectedClient(res[0]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedClient]);

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen, loadStatus]);

  const handleInstall = async (clientId: string) => {
    try {
      const clientName = await invoke<string>("install_mcp_config", { clientId });
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

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[640px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-900/30 rounded-lg">
              <Cpu size={20} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">{t("mcp.title")}</h2>
              <p className="text-xs text-secondary">{t("mcp.subtitle")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-secondary hover:text-primary hover:bg-surface-tertiary rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="bg-surface-secondary/50 p-4 rounded-lg border border-strong">
            <p className="text-sm text-secondary leading-relaxed">
              {t("mcp.description")}
            </p>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted">{t("mcp.checking")}</div>
          ) : (
            <>
              {/* Client cards */}
              <div className="space-y-2">
                <label className="text-xs uppercase font-bold text-muted">{t("mcp.clients")}</label>
                <div className="space-y-2">
                  {clients.map((client) => (
                    <button
                      key={client.client_id}
                      onClick={() => setSelectedClient(client)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors text-left ${
                        selectedClient?.client_id === client.client_id
                          ? "border-purple-500/50 bg-purple-900/10"
                          : "border-default bg-base hover:border-strong"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 flex items-center justify-center shrink-0">
                          <ClientIcon clientId={client.client_id} size={22} />
                        </div>
                        <div>
                          <div className="font-medium text-primary text-sm flex items-center gap-2">
                            {client.client_name}
                            {client.client_type === "command" && (
                              <Terminal size={11} className="text-muted" />
                            )}
                          </div>
                          <div className="text-xs text-muted font-mono mt-0.5 truncate max-w-[360px]">
                            {client.config_path ?? t("mcp.notFound")}
                          </div>
                        </div>
                      </div>
                      {client.installed ? (
                        <div className="flex items-center gap-2 text-green-400 bg-green-900/20 px-3 py-1 rounded-full text-xs font-medium border border-green-900/50 shrink-0">
                          <Check size={12} />
                          <span>{t("mcp.installed")}</span>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInstall(client.client_id);
                          }}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors shadow-lg shadow-blue-900/20 shrink-0"
                        >
                          {t("mcp.install")}
                        </button>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Manual config for selected client */}
              {selectedClient && !selectedClient.installed && (
                <div className="space-y-2">
                  <label className="text-xs uppercase font-bold text-muted">
                    {isCommandClient ? t("mcp.manualCommand") : t("mcp.manualConfig")}
                    {" — "}
                    {selectedClient.client_name}
                  </label>

                  {isCommandClient ? (
                    /* CLI command block */
                    <div className="relative group">
                      <div className="rounded-lg border border-default bg-base p-3 font-mono text-xs text-secondary break-all pr-10">
                        {cliCommand}
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(cliCommand);
                          setCopiedCmd(true);
                          setTimeout(() => setCopiedCmd(false), 2000);
                        }}
                        className="absolute top-2 right-2 p-1.5 bg-surface-secondary text-secondary hover:text-primary rounded opacity-0 group-hover:opacity-100 transition-all"
                      >
                        {copiedCmd ? (
                          <Check size={13} className="text-green-400" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>
                  ) : (
                    /* JSON config block */
                    <div className="relative group">
                      <div className="rounded-lg overflow-hidden border border-default">
                        <Editor
                          height="160px"
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
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(jsonValue);
                          setCopiedJson(true);
                          setTimeout(() => setCopiedJson(false), 2000);
                        }}
                        className="absolute top-2 right-2 p-2 bg-surface-secondary text-secondary hover:text-primary rounded opacity-0 group-hover:opacity-100 transition-all z-10"
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
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary hover:bg-surface-tertiary transition-colors text-sm rounded-lg"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
