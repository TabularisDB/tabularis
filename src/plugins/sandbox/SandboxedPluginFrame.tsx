import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl as openExternal } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { useToast } from "../../hooks/useToast";
import { ThemeContext } from "../../contexts/ThemeContext";
import { isReadOnlyQuery } from "../../utils/sqlAnalysis";
import type { SlotContext } from "../../types/pluginSlots";
import { connectFrame, pluginFrameUrl } from "./connectFrame";
import { serializePluginSlotContext } from "./slotContext";
import type { RpcPort } from "./rpc";

interface Props {
  pluginId: string;
  module: string;
  context: SlotContext;
}

const MAX_HEIGHT = 4000;

export function SandboxedPluginFrame({ pluginId, module, context }: Props) {
  const { settings, updateSetting } = useSettings();
  const { showToast } = useToast();
  const { i18n } = useTranslation();
  const language = i18n.language;
  const theme = useContext(ThemeContext);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const rpcRef = useRef<RpcPort | null>(null);
  const guestContext: SlotContext = useMemo(
    () => ({
      ...context,
      pluginSettings: settings.plugins?.[pluginId]?.settings ?? {},
      translations:
        i18n.getResourceBundle(language?.split("-")[0] ?? language, pluginId) ?? {},
      theme: theme
        ? {
            themeId: theme.currentTheme.id,
            themeName: theme.currentTheme.name,
            isDark: !theme.currentTheme.id.includes("-light"),
            colors: theme.currentTheme.colors,
          }
        : null,
    }),
    [context, i18n, language, pluginId, settings.plugins, theme],
  );
  const contextRef = useRef(guestContext);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const controller = new AbortController();
    let disposed = false;
    const handlers = {
      "ui.resize": (value: unknown) => {
        const requested = typeof value === "number" ? value : 0;
        setHeight(Math.min(MAX_HEIGHT, Math.max(0, requested)));
      },
      "slot.context": () => serializePluginSlotContext(contextRef.current),
      "slot.onDatabaseChange": (value: unknown) => {
        if (typeof value !== "string") throw new Error("Database must be a string");
        const callback = contextRef.current.onDatabaseChange;
        if (typeof callback !== "function") throw new Error("Database change is unavailable in this slot");
        callback(value);
      },
      "slot.setExtraField": (key: unknown, value: unknown) => {
        if (typeof key !== "string" || !key || key.length > 256 || typeof value !== "string" || value.length > 16_384) {
          throw new Error("Invalid connection field value");
        }
        const callback = contextRef.current.setExtraField;
        if (typeof callback !== "function") throw new Error("Extra fields are unavailable in this slot");
        callback(key, value);
      },
      "slot.setCredentialFieldsHidden": (hidden: unknown) => {
        if (typeof hidden !== "boolean") throw new Error("Credential visibility must be a boolean");
        const callback = contextRef.current.setCredentialFieldsHidden;
        if (typeof callback !== "function") throw new Error("Credential fields are unavailable in this slot");
        callback(hidden);
      },
      "api.query": async (query: unknown) => {
        if (typeof query !== "string" || query.trim().length === 0 || query.length > 100_000) {
          throw new Error("SQL query must contain between 1 and 100,000 characters");
        }
        if (!isReadOnlyQuery(query)) {
          throw new Error("Plugin SQL statement type is not allowed by the host filter");
        }
        const active = contextRef.current;
        if (typeof active.connectionId !== "string" || !active.connectionId) {
          throw new Error("No active connection");
        }
        return invoke<{ columns: string[]; rows: unknown[][] }>("execute_plugin_read_only_query", {
          connectionId: active.connectionId,
          query,
          ...(typeof active.schema === "string" && active.schema
            ? { schema: active.schema }
            : {}),
        });
      },
      "api.toast": async (kind: unknown, text: unknown) => {
        if (typeof text !== "string" || text.length === 0 || text.length > 4_000) {
          throw new Error("Notification text must contain between 1 and 4,000 characters");
        }
        const toastKind = kind === "error" || kind === "warning" ? kind : "info";
        showToast(text, { kind: toastKind });
      },
      "api.setting.set": async (key: unknown, value: unknown) => {
        if (typeof key !== "string" || !key) throw new Error("Setting key is required");
        const serialized = JSON.stringify(value);
        if (typeof serialized !== "string" || serialized.length > 65_536) {
          throw new Error("Plugin settings must be JSON values smaller than 64 KiB");
        }
        const safeValue = JSON.parse(serialized) as unknown;
        await updateSetting("plugins", (previous) => {
          const plugins = previous ?? {};
          const pluginConfig = plugins[pluginId] ?? {};
          return {
            ...plugins,
            [pluginId]: {
              ...pluginConfig,
              settings: { ...(pluginConfig.settings ?? {}), [key]: safeValue },
            },
          };
        });
        return null;
      },
      "api.openUrl": async (value: unknown) => {
        if (typeof value !== "string") throw new Error("URL must be a string");
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          throw new Error("Only HTTP and HTTPS URLs can be opened");
        }
        if (url.username || url.password) throw new Error("URLs containing credentials cannot be opened");
        await openExternal(url.toString());
        return null;
      },
      "api.oauth.googleToken": async (value: unknown) => {
        if (pluginId !== "google-sheets") {
          throw new Error("Google OAuth token exchange is only available to the Google Sheets plugin");
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("Invalid Google OAuth token request");
        }
        const input = value as Record<string, unknown>;
        const allowed = new Set([
          "grant_type", "code", "client_id", "client_secret", "redirect_uri", "code_verifier", "refresh_token",
        ]);
        if (Object.keys(input).some((key) => !allowed.has(key))) {
          throw new Error("Unsupported Google OAuth token field");
        }
        const grantType = input.grant_type;
        if (grantType !== "authorization_code" && grantType !== "refresh_token") {
          throw new Error("Unsupported Google OAuth grant type");
        }
        const fields = new URLSearchParams();
        for (const [key, field] of Object.entries(input)) {
          if (typeof field !== "string" || !field || field.length > 16_384) {
            throw new Error(`Invalid Google OAuth field: ${key}`);
          }
          fields.set(key, field);
        }
        if (typeof input.client_id !== "string" ||
          (grantType === "authorization_code" && (typeof input.code !== "string" || typeof input.redirect_uri !== "string")) ||
          (grantType === "refresh_token" && typeof input.refresh_token !== "string")) {
          throw new Error("Missing required Google OAuth fields");
        }
        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: fields,
        });
        if (!response.ok) throw new Error(`Google OAuth token request failed (${response.status})`);
        const token = await response.json() as Record<string, unknown>;
        if (typeof token.access_token !== "string" || typeof token.expires_in !== "number") {
          throw new Error("Google returned an invalid token response");
        }
        return {
          access_token: token.access_token,
          expires_in: token.expires_in,
          ...(typeof token.refresh_token === "string" ? { refresh_token: token.refresh_token } : {}),
          ...(typeof token.scope === "string" ? { scope: token.scope } : {}),
          ...(typeof token.token_type === "string" ? { token_type: token.token_type } : {}),
        };
      },
      "host.loadFailed": (message: unknown) => {
        console.error(`[PluginSlot] ${pluginId}/${module}: ${String(message)}`);
      },
    };

    void connectFrame(frame, handlers, controller.signal).then(async (rpc) => {
      if (disposed) {
        rpc.close();
        return;
      }
      rpcRef.current = rpc;
      try {
        await rpc.call("slot.context", [serializePluginSlotContext(contextRef.current)]);
      } catch (error) {
        console.error(`[PluginSlot] Failed to initialize ${pluginId}/${module}`, error);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error(`[PluginSlot] Failed to connect ${pluginId}/${module}`, error);
      }
    });

    return () => {
      disposed = true;
      controller.abort();
      rpcRef.current?.close();
      rpcRef.current = null;
    };
  }, [module, pluginId, showToast, updateSetting]);

  useEffect(() => {
    contextRef.current = guestContext;
    void rpcRef.current?.call("slot.context", [serializePluginSlotContext(guestContext)]).catch(() => undefined);
  }, [guestContext]);

  return (
    <iframe
      ref={frameRef}
      title={`Plugin ${pluginId}`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={pluginFrameUrl(pluginId, module)}
      style={{ width: "100%", height, border: 0 }}
    />
  );
}
