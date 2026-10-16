import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useToast } from "../../hooks/useToast";
import type { TeamShareStatus, TeamShareSyncReport, UnlockPromptTrigger } from "../../utils/teamShare";
import {
  shouldOpenUnlockPrompt,
  TEAM_SHARE_EVENTS,
  TEAM_SHARE_UNLOCK_REQUEST,
} from "../../utils/teamShare";
import { TeamShareUnlockModal } from "./TeamShareUnlockModal";

/**
 * Asks for the team-share master password, and reports what a sync resolved.
 *
 * The master password is deliberately not persisted, so the shared credentials
 * are unavailable until it is typed — that is the whole point of the feature,
 * and why this prompt comes back on every launch. Once dismissed it stays
 * closed until the user explicitly asks for something that needs the share
 * (connecting to a shared connection): the backend also reports locked
 * lookups nobody asked for, and reopening on each would make dismissing
 * pointless.
 *
 * Mounted once at the App level, so it shows over whatever page is open.
 */
export function TeamShareGate() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [status, setStatus] = useState<TeamShareStatus | null>(null);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  // A ref, not state: the listeners below read it without being re-created.
  const dismissedRef = useRef(false);

  const consider = useCallback((trigger: UnlockPromptTrigger) => {
    invoke<TeamShareStatus>("get_team_share_status")
      .then((current) => {
        setStatus(current);
        if (shouldOpenUnlockPrompt(current, trigger, dismissedRef.current)) {
          setIsPromptOpen(true);
        }
      })
      .catch((e) => {
        console.error("Failed to read the team share status:", e);
      });
  }, []);

  useEffect(() => {
    consider("startup");
  }, [consider]);

  // Something reached for a shared connection while the vault was locked. An
  // edit, export or duplicate is the user asking; a lookup may not be.
  useEffect(() => {
    const unlisten = listen<{ explicit?: boolean } | null>(TEAM_SHARE_EVENTS.locked, (event) =>
      consider(event.payload?.explicit ? "explicit" : "locked"),
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [consider]);

  // The user asked for something that needs the share, e.g. connecting.
  useEffect(() => {
    const onRequest = () => consider("explicit");
    window.addEventListener(TEAM_SHARE_UNLOCK_REQUEST, onRequest);
    return () => window.removeEventListener(TEAM_SHARE_UNLOCK_REQUEST, onRequest);
  }, [consider]);

  // Unlocked from settings, or left: the prompt has nothing left to ask.
  useEffect(() => {
    const unlisten = listen<TeamShareStatus>(TEAM_SHARE_EVENTS.status, (event) => {
      setStatus(event.payload);
      if (event.payload.unlocked || !event.payload.configured) {
        dismissedRef.current = false;
        setIsPromptOpen(false);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // A conflict means a teammate's change was overwritten by this machine's.
  // Silently winning is the one outcome the user has to know about: the
  // classic case is a colleague rotating a password we then overwrote.
  useEffect(() => {
    const unlisten = listen<TeamShareSyncReport>(TEAM_SHARE_EVENTS.synced, (event) => {
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
    dismissedRef.current = false;
    setStatus(next);
    setIsPromptOpen(false);
  }, []);

  const handleClose = useCallback(() => {
    dismissedRef.current = true;
    setIsPromptOpen(false);
  }, []);

  return (
    <TeamShareUnlockModal
      isOpen={isPromptOpen}
      status={status}
      onUnlocked={handleUnlocked}
      onClose={handleClose}
    />
  );
}
