import { useState } from "react";
import { usePluginConnection, usePluginModal, usePluginTranslation, usePluginRpc, type SlotComponentProps } from "@tabularis/plugin-api";
import { NeonPanel } from "./NeonPanel";
import { styles } from "./styles";

export default function NeonActions({ context }: SlotComponentProps) {
  const active = usePluginConnection();
  const t = usePluginTranslation("neon");
  const { openModal } = usePluginModal();
  const [openSequence, setOpenSequence] = useState(0);
  const isSettings = context.targetPluginId === "neon";
  if (context.targetPluginId && !isSettings) return null;
  if (!isSettings && context.driver !== "neon") return null;
  if (typeof usePluginRpc !== "function") return <p role="status">{t("coreRequired")}</p>;
  const connectionId = context.connectionId ?? (active.driver === "neon" ? active.connectionId : null);
  return <>
    <style>{styles}</style>
    <button type="button" aria-label={t(isSettings ? "manage" : "open")} className={`neon-launch${isSettings ? " neon-launch-settings" : ""}`} onClick={() => {
      const next = openSequence + 1;
      setOpenSequence(next);
      openModal({ title: t("title"), size: "xl", content: <NeonPanel key={next} connectionId={connectionId} connectionName={typeof context.connectionName === "string" ? context.connectionName : undefined} /> });
    }}>
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 16V4h10l4 4v8h-5V9l-5 7H3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
      <span>{t(isSettings ? "manage" : "launcher")}</span>
    </button>
  </>;
}
