import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabularisClient } from "./useTabularisClient";
import type { TabularisClient } from "../api/client";
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
  const client = useTabularisClient();
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
      const data = await client.call("get_ai_activity", {
        filter: stableFilter,
      });
      setEvents(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [client, stableFilter]);

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
  const client = useTabularisClient();
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.call("get_ai_sessions", undefined);
      setSessions(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

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
  const client = useTabularisClient();
  const [events, setEvents] = useState<AiActivityEvent[]>([]);
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(
    async (id: string, isCancelled: () => boolean) => {
      setLoading(true);
      setError(null);
      try {
        const data = await client.call("get_ai_session_events", {
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
    [client],
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
  const client = useTabularisClient();
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetchRef = useRef<() => Promise<void>>(async () => {});

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.call("list_pending_approvals", undefined);
      setPending(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);
  refetchRef.current = refetch;

  useEffect(() => {
    refetch();
    const unsubscribe = client.subscribe(PENDING_APPROVAL_EVENT, () => {
      refetchRef.current();
    });
    return () => {
      unsubscribe.then((fn) => fn()).catch(() => {});
    };
  }, [client, refetch]);

  const decide = useCallback(
    async ({
      approvalId,
      decision,
      reason,
      editedQuery,
    }: ApprovalDecisionPayload) => {
      await client.call("decide_pending_approval", {
        approvalId,
        decision,
        reason,
        editedQuery,
      });
      // Optimistically drop the approval from the list — the file watcher
      // will reconcile if anything else changes.
      setPending((prev) => prev.filter((p) => p.id !== approvalId));
    },
    [client],
  );

  return { pending, loading, error, refetch, decide };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function clearAiActivity(client: TabularisClient): Promise<void> {
  await client.call("clear_ai_activity", undefined);
}

export function exportAiActivityJson(client: TabularisClient): Promise<string> {
  return client.call("export_ai_activity_json", undefined);
}

export function exportAiActivityCsv(client: TabularisClient): Promise<string> {
  return client.call("export_ai_activity_csv", undefined);
}

export function exportSessionAsNotebook(
  client: TabularisClient,
  sessionId: string,
): Promise<AiNotebookExport> {
  return client.call("export_ai_session_as_notebook", { sessionId });
}
