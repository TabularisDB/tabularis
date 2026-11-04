import type {ExplainPlan} from '@tabularis/explain';
import type {ExplainViewMode} from '@tabularis/explain/react';
import type {PlatformCapabilities} from './capabilities';
import {buildRouteWindowLabel, buildVisualExplainSessionRoute} from '@/routing';

export const VISUAL_EXPLAIN_SESSION_REQUEST_EVENT = 'secondary-window:explain-session-request';
export const VISUAL_EXPLAIN_SESSION_DATA_EVENT = 'secondary-window:explain-session-data';

/** A plan handed from the window that ran it to a window of its own. */
export interface VisualExplainSession {
    readonly plan: ExplainPlan;
    readonly viewMode: ExplainViewMode;
    readonly selectedNodeId: string | null;
    /** Shown under the window title, e.g. the connection and database. */
    readonly label: string;
}

export interface VisualExplainSessionRequest {
    readonly sessionId: string;
}

export interface VisualExplainSessionData {
    readonly sessionId: string;
    readonly session: VisualExplainSession;
}

export interface VisualExplainSessionHostOptions {
    readonly createSessionId?: () => string;
    /** Sessions kept for windows that reload; the oldest is dropped first. */
    readonly maxSessions?: number;
}

const DEFAULT_MAX_SESSIONS = 20;

/**
 * Keeps the plans opened in their own window and answers each window's request
 * for its plan. Lives in the window that opened them, so it outlives the modal
 * the user detached the plan from; a window that reloads asks again and gets
 * the same plan.
 */
export class VisualExplainSessionHost {
    private readonly platform: PlatformCapabilities;
    private readonly createSessionId: () => string;
    private readonly maxSessions: number;
    private readonly sessions = new Map<string, VisualExplainSession>();
    private readonly ready: Promise<void>;
    private unsubscribe: (() => void) | null = null;

    constructor(platform: PlatformCapabilities, options: VisualExplainSessionHostOptions = {}) {
        this.platform = platform;
        this.createSessionId = options.createSessionId ?? (() => crypto.randomUUID());
        this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
        this.ready = this.subscribe();
    }

    /** Opens `session` in a new window and returns its id. */
    async open(session: VisualExplainSession): Promise<string> {
        await this.ready;
        const sessionId = this.createSessionId();
        this.sessions.set(sessionId, session);
        while (this.sessions.size > this.maxSessions) {
            const oldest = this.sessions.keys().next().value;
            if (oldest === undefined) break;
            this.sessions.delete(oldest);
        }

        try {
            await this.platform.openRoute({
                route: buildVisualExplainSessionRoute(sessionId),
                target: 'new',
                label: buildRouteWindowLabel('visual-explain', sessionId),
                title: session.label
                    ? `tabularis - Visual Explain (${session.label})`
                    : 'tabularis - Visual Explain',
                window: {width: 1280, height: 820, minWidth: 900, minHeight: 600},
            });
        } catch (cause) {
            this.sessions.delete(sessionId);
            throw cause;
        }
        return sessionId;
    }

    async dispose(): Promise<void> {
        await this.ready;
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.sessions.clear();
    }

    private async subscribe(): Promise<void> {
        this.unsubscribe = await this.platform.subscribeRouteEvent<VisualExplainSessionRequest>(
            VISUAL_EXPLAIN_SESSION_REQUEST_EVENT,
            ({sessionId}) => {
                const session = this.sessions.get(sessionId);
                // Every window hears the request; only the one holding the plan answers.
                if (!session) return;
                void this.platform.publishRouteEvent<VisualExplainSessionData>(
                    VISUAL_EXPLAIN_SESSION_DATA_EVENT,
                    {sessionId, session},
                );
            },
        );
    }
}

const hosts = new WeakMap<PlatformCapabilities, VisualExplainSessionHost>();

export function getVisualExplainSessionHost(
    platform: PlatformCapabilities,
): VisualExplainSessionHost {
    const existing = hosts.get(platform);
    if (existing) return existing;
    const host = new VisualExplainSessionHost(platform);
    hosts.set(platform, host);
    return host;
}

/**
 * Asks the window that opened `sessionId` for its plan. Resolves to null when
 * nobody answers within `timeoutMs` (that window was closed or reloaded).
 */
export async function requestVisualExplainSession(
    platform: PlatformCapabilities,
    sessionId: string,
    timeoutMs: number,
): Promise<VisualExplainSession | null> {
    let answer: (session: VisualExplainSession | null) => void = () => {};
    const answered = new Promise<VisualExplainSession | null>((resolve) => {
        answer = resolve;
    });
    const unsubscribe = await platform.subscribeRouteEvent<VisualExplainSessionData>(
        VISUAL_EXPLAIN_SESSION_DATA_EVENT,
        (data) => {
            if (data.sessionId === sessionId) answer(data.session);
        },
    );
    const timeout = setTimeout(() => answer(null), timeoutMs);
    try {
        await platform.publishRouteEvent<VisualExplainSessionRequest>(
            VISUAL_EXPLAIN_SESSION_REQUEST_EVENT,
            {sessionId},
        );
        return await answered;
    } finally {
        clearTimeout(timeout);
        unsubscribe();
    }
}
