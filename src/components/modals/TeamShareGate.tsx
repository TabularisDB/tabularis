import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useToast } from "../../hooks/useToast";
import type { TeamShareStatus, TeamShareSyncReport } from "../../utils/teamShare";
import { needsUnlockPrompt } from "../../utils/teamShare";
import { TeamShareUnlockModal } from "./TeamShareUnlockModal";

/**
 * Asks for the team-share master password, and reports what a sync resolved.
 *
 * The master password is deliberately not persisted, so the shared credentials
 * are unavailable until it is typed — that is the whole point of the feature,
 * and why this prompt comes back on every launch. It also comes back when
 * something reaches for a shared connection while the vault is locked, so
 * dismissing it at startup is not a dead end.
 *
 * Mounted once at the App level, so it shows over whatever page is open.
 */
export function TeamShareGate() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [status, setStatus] = useState<TeamShareStatus | null>(null);
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<TeamShareStatus>("get_team_share_status")
      .then((current) => {
        if (cancelled) return;
        setStatus(current);
        setIsPromptOpen(needsUnlockPrompt(current));
      })
      .catch((e) => {
        console.error("Failed to read the team share status:", e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Something asked for a shared connection while the vault was locked.
  useEffect(() => {
    const unlisten = listen("team-share-locked", () => {
      invoke<TeamShareStatus>("get_team_share_status")
        .then((current) => {
          setStatus(current);
          setIsPromptOpen(needsUnlockPrompt(current));
        })
        .catch(() => {});
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // A conflict means a teammate's change was overwritten by this machine's.
  // Silently winning is the one outcome the user has to know about: the
  // classic case is a colleague rotating a password we then overwrote.
  useEffect(() => {
    const unlisten = listen<TeamShareSyncReport>("team-share-synced", (event) => {
      const conflicts = event.payload?.conflicts ?? 0;
      if (conflicts > 0) {
        showToast(t("settings.teamShare.conflictToast", { count: conflicts }), {
          title: t("settings.teamShare.conflictToastTitle"),
          kind: "warning",
          duration: 0,
        });
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [showToast, t]);

  const handleUnlocked = useCallback((next: TeamShareStatus) => {
    setStatus(next);
    setIsPromptOpen(false);
  }, []);

  const handleClose = useCallback(() => setIsPromptOpen(false), []);

  return (
    <TeamShareUnlockModal
      isOpen={isPromptOpen}
      status={status}
      onUnlocked={handleUnlocked}
      onClose={handleClose}
    />
  );
}
