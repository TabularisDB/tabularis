import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseExplain} from '@tabularis/explain';
import type {
    OpenRouteRequest,
    PlatformCapabilities,
    RouteEventHandler,
    UnsubscribeRouteEvent,
} from '@/platform/capabilities';
import {
    VISUAL_EXPLAIN_SESSION_DATA_EVENT,
    VISUAL_EXPLAIN_SESSION_REQUEST_EVENT,
    VisualExplainSessionHost,
    getVisualExplainSessionHost,
    requestVisualExplainSession,
    type VisualExplainSession,
    type VisualExplainSessionData,
} from '@/platform/visualExplainSessions';
import {buildVisualExplainSessionRoute} from '@/routing';

/** One route event bus shared by every window, like Tauri events or a BroadcastChannel. */
class RouteEventBus {
    readonly listeners = new Map<string, Set<RouteEventHandler<unknown>>>();

    async publish<T>(event: string, payload: T): Promise<void> {
        for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
    }

    async subscribe<T>(
        event: string,
        handler: RouteEventHandler<T>,
    ): Promise<UnsubscribeRouteEvent> {
        const listeners = this.listeners.get(event) ?? new Set();
        const listener = handler as RouteEventHandler<unknown>;
        listeners.add(listener);
        this.listeners.set(event, listeners);
        return () => listeners.delete(listener);
    }

    count(event: string): number {
        return this.listeners.get(event)?.size ?? 0;
    }

    window(openRoute = vi.fn<(request: OpenRouteRequest) => Promise<void>>(async () => {})) {
        const platform = {
            openRoute,
            publishRouteEvent: (event: string, payload: unknown) => this.publish(event, payload),
            subscribeRouteEvent: (event: string, handler: RouteEventHandler<unknown>) =>
                this.subscribe(event, handler),
        } as unknown as PlatformCapabilities;
        return {platform, openRoute};
    }
}

function makeSession(label = 'shop · shop'): VisualExplainSession {
    return {
        plan: parseExplain('[{"Plan":{"Node Type":"Result"}}]'),
        viewMode: 'table',
        selectedNodeId: 'node_0',
        label,
    };
}

function sequentialIds(): () => string {
    let next = 0;
    return () => `session-${++next}`;
}

describe('visualExplainSessions', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('builds the route of a handed-over plan', () => {
        expect(buildVisualExplainSessionRoute('a/b c')).toBe('/visual-explain?session=a%2Fb%20c');
    });

    it('opens each plan in a window of its own', async () => {
        const bus = new RouteEventBus();
        const {platform, openRoute} = bus.window();
        const host = new VisualExplainSessionHost(platform, {createSessionId: sequentialIds()});

        await expect(host.open(makeSession())).resolves.toBe('session-1');
        await expect(host.open(makeSession(''))).resolves.toBe('session-2');

        expect(openRoute).toHaveBeenNthCalledWith(1, {
            route: '/visual-explain?session=session-1',
            target: 'new',
            label: 'visual-explain-session-1',
            title: 'tabularis - Visual Explain (shop · shop)',
            window: {width: 1280, height: 820, minWidth: 900, minHeight: 600},
        });
        expect(openRoute).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                label: 'visual-explain-session-2',
                title: 'tabularis - Visual Explain',
            }),
        );
    });

    it('gives the new window its plan, and again after a reload', async () => {
        const bus = new RouteEventBus();
        const host = new VisualExplainSessionHost(bus.window().platform, {
            createSessionId: sequentialIds(),
        });
        const session = makeSession();
        const sessionId = await host.open(session);
        const detached = bus.window().platform;

        await expect(requestVisualExplainSession(detached, sessionId, 1000)).resolves.toEqual(
            session,
        );
        await expect(requestVisualExplainSession(detached, sessionId, 1000)).resolves.toEqual(
            session,
        );
        // The request stops listening once answered.
        expect(bus.count(VISUAL_EXPLAIN_SESSION_DATA_EVENT)).toBe(0);
    });

    it('answers only for its own sessions, so other windows can share the bus', async () => {
        const bus = new RouteEventBus();
        const first = new VisualExplainSessionHost(bus.window().platform, {
            createSessionId: () => 'first',
        });
        const second = new VisualExplainSessionHost(bus.window().platform, {
            createSessionId: () => 'second',
        });
        await first.open(makeSession('first window'));
        await second.open(makeSession('second window'));
        const answers: VisualExplainSessionData[] = [];
        await bus.subscribe<VisualExplainSessionData>(VISUAL_EXPLAIN_SESSION_DATA_EVENT, (data) =>
            answers.push(data),
        );

        await bus.publish(VISUAL_EXPLAIN_SESSION_REQUEST_EVENT, {sessionId: 'second'});
        await bus.publish(VISUAL_EXPLAIN_SESSION_REQUEST_EVENT, {sessionId: 'unknown'});

        expect(answers).toHaveLength(1);
        expect(answers[0].sessionId).toBe('second');
        expect(answers[0].session.label).toBe('second window');
    });

    it('resolves to null when nobody holds the plan any more', async () => {
        vi.useFakeTimers();
        const bus = new RouteEventBus();
        const pending = requestVisualExplainSession(bus.window().platform, 'gone', 2000);

        await vi.advanceTimersByTimeAsync(1999);
        expect(bus.count(VISUAL_EXPLAIN_SESSION_DATA_EVENT)).toBe(1);
        await vi.advanceTimersByTimeAsync(1);

        await expect(pending).resolves.toBeNull();
        expect(bus.count(VISUAL_EXPLAIN_SESSION_DATA_EVENT)).toBe(0);
    });

    it('ignores answers meant for another window', async () => {
        vi.useFakeTimers();
        const bus = new RouteEventBus();
        const pending = requestVisualExplainSession(bus.window().platform, 'mine', 2000);
        await vi.advanceTimersByTimeAsync(0);

        await bus.publish(VISUAL_EXPLAIN_SESSION_DATA_EVENT, {
            sessionId: 'theirs',
            session: makeSession(),
        });
        await vi.advanceTimersByTimeAsync(2000);

        await expect(pending).resolves.toBeNull();
    });

    it('forgets the oldest plans beyond its limit', async () => {
        const bus = new RouteEventBus();
        const host = new VisualExplainSessionHost(bus.window().platform, {
            createSessionId: sequentialIds(),
            maxSessions: 2,
        });
        await host.open(makeSession('one'));
        await host.open(makeSession('two'));
        await host.open(makeSession('three'));
        const detached = bus.window().platform;

        await expect(requestVisualExplainSession(detached, 'session-1', 10)).resolves.toBeNull();
        await expect(requestVisualExplainSession(detached, 'session-2', 10)).resolves.toMatchObject(
            {label: 'two'},
        );
        await expect(requestVisualExplainSession(detached, 'session-3', 10)).resolves.toMatchObject(
            {label: 'three'},
        );
    });

    it('drops the plan and reports the error when the window cannot open', async () => {
        const bus = new RouteEventBus();
        const {platform} = bus.window(
            vi.fn<(request: OpenRouteRequest) => Promise<void>>(async () => {
                throw new Error('window refused');
            }),
        );
        const host = new VisualExplainSessionHost(platform, {createSessionId: () => 'failed'});

        await expect(host.open(makeSession())).rejects.toThrow('window refused');
        await expect(requestVisualExplainSession(platform, 'failed', 10)).resolves.toBeNull();
    });

    it('stops answering once disposed', async () => {
        const bus = new RouteEventBus();
        const {platform} = bus.window();
        const host = new VisualExplainSessionHost(platform, {createSessionId: () => 'kept'});
        await host.open(makeSession());

        await host.dispose();

        expect(bus.count(VISUAL_EXPLAIN_SESSION_REQUEST_EVENT)).toBe(0);
        await expect(requestVisualExplainSession(platform, 'kept', 10)).resolves.toBeNull();
    });

    it('keeps one host per platform', () => {
        const bus = new RouteEventBus();
        const {platform} = bus.window();

        expect(getVisualExplainSessionHost(platform)).toBe(getVisualExplainSessionHost(platform));
        expect(getVisualExplainSessionHost(bus.window().platform)).not.toBe(
            getVisualExplainSessionHost(platform),
        );
    });
});
