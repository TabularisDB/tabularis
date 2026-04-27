import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AiActivityEvent,
  AiEventFilter,
  AiNotebookExport,
  AiSessionSummary,
  ApprovalDecisionPayload,
  PendingApproval,
} from "../types/ai";

const PENDING_APPROVAL_EVENT = "ai://pending_approval";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface UseAiActivityEventsResult {
  events: AiActivityEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAiActivityEvents(
  filter: AiEventFilter = {},
): UseAiActivityEventsResult {
  const [events, setEvents] = useState<AiActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stabilise the filter reference so `useCallback` below does not re-bind on
  // every render (callers can pass an inline object literal safely).
  const filterKey = JSON.stringify(filter);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey captures filter content
  const stableFilter = useMemo(() => filter, [filterKey]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<AiActivityEvent[]>("get_ai_activity", {
        filter: stableFilter,
      });
      setEvents(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [stableFilter]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { events, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface UseAiSessionsResult {
  sessions: AiSessionSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAiSessions(): UseAiSessionsResult {
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<AiSessionSummary[]>("get_ai_sessions");
      setSessions(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { sessions, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// Single session events
// ---------------------------------------------------------------------------

export interface UseAiSessionEventsResult {
  events: AiActivityEvent[];
  loading: boolean;
  error: string | null;
}

export function useAiSessionEvents(
  sessionId: string | null,
): UseAiSessionEventsResult {
  const [events, setEvents] = useState<AiActivityEvent[]>([]);
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(
    async (id: string, isCancelled: () => boolean) => {
      setLoading(true);
      setError(null);
      try {
        const data = await invoke<AiActivityEvent[]>("get_ai_session_events", {
          sessionId: id,
        });
        if (!isCancelled()) {
          setEvents(data);
          setLoadedSessionId(id);
        }
      } catch (err) {
        if (!isCancelled()) setError(String(err));
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetchSession(sessionId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [sessionId, fetchSession]);

  // Derive an empty list when no session is selected (or while a new session
  // is loading) instead of clearing state inside the effect body.
  const visibleEvents =
    sessionId !== null && sessionId === loadedSessionId ? events : [];

  return { events: visibleEvents, loading, error };
}

// ---------------------------------------------------------------------------
// Pending approvals
// ---------------------------------------------------------------------------

export interface UsePendingApprovalsResult {
  pending: PendingApproval[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  decide: (payload: ApprovalDecisionPayload) => Promise<void>;
}

export function usePendingApprovals(): UsePendingApprovalsResult {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetchRef = useRef<() => Promise<void>>(async () => {});

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<PendingApproval[]>("list_pending_approvals");
      setPending(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);
  refetchRef.current = refetch;

  useEffect(() => {
    refetch();
    const unlisten = listen<PendingApproval>(PENDING_APPROVAL_EVENT, () => {
      refetchRef.current();
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [refetch]);

  const decide = useCallback(
    async ({
      approvalId,
      decision,
      reason,
      editedQuery,
    }: ApprovalDecisionPayload) => {
      await invoke("decide_pending_approval", {
        approvalId,
        decision,
        reason,
        editedQuery,
      });
      // Optimistically drop the approval from the list — the file watcher
      // will reconcile if anything else changes.
      setPending((prev) => prev.filter((p) => p.id !== approvalId));
    },
    [],
  );

  return { pending, loading, error, refetch, decide };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function clearAiActivity(): Promise<void> {
  await invoke("clear_ai_activity");
}

export async function exportAiActivityJson(): Promise<string> {
  return invoke<string>("export_ai_activity_json");
}

export async function exportAiActivityCsv(): Promise<string> {
  return invoke<string>("export_ai_activity_csv");
}

export async function exportSessionAsNotebook(
  sessionId: string,
): Promise<AiNotebookExport> {
  return invoke<AiNotebookExport>("export_ai_session_as_notebook", {
    sessionId,
  });
}
