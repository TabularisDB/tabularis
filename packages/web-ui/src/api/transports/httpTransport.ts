import type {TabularisTransport} from '@/api/client';
import type {
    CommandCallOptions,
    CommandName,
    CommandRequest,
    CommandResponse,
    UnmigratedCommandTracking,
} from '@/api/contract';
import {
    createRequestId,
    normalizeTabularisError,
    TabularisClientError,
    type RpcResponse,
    type TabularisError,
    type RequestId,
} from '@/api/errors';
import {
    EVENT_AUTHORIZATION,
    type EventName,
    type EventPayload,
    type Unsubscribe,
} from '@/api/events';
import type {FileTransferMetadata, FileUploadRequest} from '@/api/fileTransfers';
import type {SessionNegotiation} from '@/api/session';

const EXPECTED_API_VERSION = 'v1';
const OPEN = 1;
const AUTHORIZATION_LEVELS = ['session', 'database', 'sensitive', 'local-admin'];
const DEFAULT_RECONNECT_DELAY_MS = 250;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 10_000;

export interface WebSocketLike {
    readonly readyState: number;
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    send(data: string): void;
    close(): void;
}

export interface HttpTransportOptions {
    readonly baseUrl?: string;
    readonly fetch?: typeof fetch;
    readonly createWebSocket?: (url: string) => WebSocketLike;
    readonly reconnectDelayMs?: number;
    readonly maxReconnectDelayMs?: number;
    readonly startDownload?: (url: string) => void;
    /** Opens the login page after a password session expired. */
    readonly openLogin?: (url: string) => void;
}

type EventHandler<K extends EventName> = (payload: EventPayload<K>) => void;
type EventHandlers = {
    [K in EventName]?: Set<EventHandler<K>>;
};

type ServerEventMessage = {
    type: 'event';
    event: string;
    payload: unknown;
    sequence: number;
};

export class HttpTransport implements TabularisTransport {
    private readonly baseUrl: string;
    private readonly fetchRequest: typeof fetch;
    private readonly createSocket: (url: string) => WebSocketLike;
    private readonly reconnectDelayMs: number;
    private readonly maxReconnectDelayMs: number;
    private readonly startBrowserDownload: (url: string) => void;
    private readonly openLogin: (url: string) => void;
    private readonly handlers: EventHandlers = {};
    private readonly pendingSubscriptions = new Map<
        EventName,
        Array<{
            resolve: () => void;
            reject: (error: TabularisClientError) => void;
        }>
    >();
    private session?: SessionNegotiation;
    private sessionPromise?: Promise<SessionNegotiation>;
    private socket: WebSocketLike | null = null;
    private connectionPromise: Promise<void> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private lastSequence = 0;
    private intentionalClose = false;

    constructor(options: HttpTransportOptions = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl ?? browserOrigin());
        this.fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.createSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
        this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
        this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS;
        this.startBrowserDownload = options.startDownload ?? startDownload;
        this.openLogin = options.openLogin ?? openLogin;
    }

    initialize(): Promise<SessionNegotiation> {
        if (this.session) return Promise.resolve(this.session);
        if (this.sessionPromise) return this.sessionPromise;

        this.sessionPromise = this.loadSession().then(
            (session) => {
                this.session = session;
                return session;
            },
            (error: unknown) => {
                this.sessionPromise = undefined;
                throw error;
            },
        );
        return this.sessionPromise;
    }

    call<K extends CommandName>(
        command: K,
        request: CommandRequest<K>,
        options?: CommandCallOptions,
    ): Promise<CommandResponse<K>> {
        return this.callRpc<CommandResponse<K>>(command, request, options);
    }

    callUnmigrated<K extends string>(
        command: K extends CommandName ? never : K,
        request: unknown,
        _tracking: UnmigratedCommandTracking,
        options?: CommandCallOptions,
    ): Promise<unknown> {
        void _tracking;
        return this.callRpc<unknown>(command, request, options);
    }

    async uploadFile(request: FileUploadRequest): Promise<FileTransferMetadata> {
        const session = await this.initialize();
        if (!session.capabilities.uploads) {
            throw clientError('UPLOADS_UNAVAILABLE', 'The server did not advertise file uploads');
        }
        const requestId = createRequestId();
        let response: Response;
        try {
            response = await this.fetchRequest(this.url(`/api/${session.apiVersion}/uploads`), {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                    accept: 'application/json',
                    'content-type': request.contents.type || 'application/octet-stream',
                    'x-request-id': requestId,
                    'x-tabularis-csrf': session.csrfToken,
                    'x-tabularis-file-name': encodeURIComponent(request.fileName),
                    'x-tabularis-purpose': request.purpose,
                },
                body: request.contents,
            });
        } catch (error) {
            throw normalizeTabularisError(error, 'UPLOAD_NETWORK_ERROR', requestId);
        }
        const responseRequestId = response.headers.get('x-request-id') ?? requestId;
        await this.checkSessionResponse(response, session, responseRequestId);
        if (!response.ok) {
            throw clientError(
                response.status === 413 ? 'UPLOAD_TOO_LARGE' : 'UPLOAD_FAILED',
                `File upload failed with HTTP ${response.status}`,
                responseRequestId,
            );
        }
        const body = await readJson(response, responseRequestId);
        if (!isFileTransferMetadata(body)) {
            throw clientError(
                'INVALID_UPLOAD_RESPONSE',
                'The server returned invalid file transfer metadata',
                responseRequestId,
            );
        }
        return body;
    }

    async consumeDownload(token: string): Promise<Blob> {
        const session = await this.initialize();
        if (!session.capabilities.downloads) {
            throw clientError(
                'DOWNLOADS_UNAVAILABLE',
                'The server did not advertise file downloads',
            );
        }
        const requestId = createRequestId();
        let response: Response;
        try {
            response = await this.fetchRequest(
                this.url(`/api/${session.apiVersion}/downloads/${encodeURIComponent(token)}`),
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        accept: 'application/octet-stream',
                        'x-request-id': requestId,
                    },
                },
            );
        } catch (error) {
            throw normalizeTabularisError(error, 'DOWNLOAD_NETWORK_ERROR', requestId);
        }
        const responseRequestId = response.headers.get('x-request-id') ?? requestId;
        await this.checkSessionResponse(response, session, responseRequestId);
        if (!response.ok) {
            throw clientError(
                'DOWNLOAD_FAILED',
                `File download failed with HTTP ${response.status}`,
                responseRequestId,
            );
        }
        return response.blob();
    }

    async requestDownload(token: string): Promise<void> {
        const session = await this.initialize();
        if (!session.capabilities.downloads) {
            throw clientError(
                'DOWNLOADS_UNAVAILABLE',
                'The server did not advertise file downloads',
            );
        }
        this.startBrowserDownload(
            this.url(`/api/${session.apiVersion}/downloads/${encodeURIComponent(token)}`),
        );
    }

    async readPluginAsset(pluginId: string, assetPath: string): Promise<string> {
        const session = await this.initialize();
        if (!session.capabilities.pluginAssets) {
            throw clientError(
                'PLUGIN_ASSETS_UNAVAILABLE',
                'The server did not advertise plugin UI assets',
            );
        }
        const requestId = createRequestId();
        let response: Response;
        try {
            response = await this.fetchRequest(
                this.url(
                    `/api/${session.apiVersion}/assets/plugins/${encodeURIComponent(pluginId)}/${encodeAssetPath(assetPath)}`,
                ),
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        accept: 'text/javascript, application/json;q=0.9, text/plain;q=0.8',
                        'x-request-id': requestId,
                    },
                },
            );
        } catch (error) {
            throw normalizeTabularisError(error, 'PLUGIN_ASSET_NETWORK_ERROR', requestId);
        }
        const responseRequestId = response.headers.get('x-request-id') ?? requestId;
        await this.checkSessionResponse(response, session, responseRequestId);
        if (!response.ok) {
            throw clientError(
                response.status === 404 ? 'PLUGIN_ASSET_NOT_FOUND' : 'PLUGIN_ASSET_READ_FAILED',
                `Plugin asset request failed with HTTP ${response.status}`,
                responseRequestId,
            );
        }
        return response.text();
    }

    async uploadConnectionIcon(file: Blob): Promise<string> {
        const session = await this.initialize();
        if (!session.capabilities.uploads) {
            throw clientError('UPLOADS_UNAVAILABLE', 'The server did not advertise file uploads');
        }
        const requestId = createRequestId();
        let response: Response;
        try {
            response = await this.fetchRequest(
                this.url(`/api/${session.apiVersion}/uploads/connection-icons`),
                {
                    method: 'POST',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        accept: 'application/json',
                        'content-type': file.type || 'application/octet-stream',
                        'x-request-id': requestId,
                        'x-tabularis-csrf': session.csrfToken,
                    },
                    body: file,
                },
            );
        } catch (error) {
            throw normalizeTabularisError(error, 'UPLOAD_NETWORK_ERROR', requestId);
        }
        const responseRequestId = response.headers.get('x-request-id') ?? requestId;
        await this.checkSessionResponse(response, session, responseRequestId);
        if (!response.ok) {
            throw clientError(
                'ICON_UPLOAD_FAILED',
                `Connection icon upload failed with HTTP ${response.status}`,
                responseRequestId,
            );
        }
        const body = await readJson(response, responseRequestId);
        if (!isIconUploadResponse(body)) {
            throw clientError(
                'INVALID_UPLOAD_RESPONSE',
                'The server returned an invalid icon upload response',
                responseRequestId,
            );
        }
        return body.token;
    }

    async uploadBlob(file: Blob): Promise<string> {
        const session = await this.initialize();
        if (!session.capabilities.uploads) {
            throw clientError('UPLOADS_UNAVAILABLE', 'The server did not advertise file uploads');
        }
        const requestId = createRequestId();
        let response: Response;
        try {
            response = await this.fetchRequest(
                this.url(`/api/${session.apiVersion}/uploads/blobs`),
                {
                    method: 'POST',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        accept: 'application/json',
                        'content-type': file.type || 'application/octet-stream',
                        'x-request-id': requestId,
                        'x-tabularis-csrf': session.csrfToken,
                    },
                    body: file,
                },
            );
        } catch (error) {
            throw normalizeTabularisError(error, 'UPLOAD_NETWORK_ERROR', requestId);
        }
        const responseRequestId = response.headers.get('x-request-id') ?? requestId;
        await this.checkSessionResponse(response, session, responseRequestId);
        if (!response.ok) {
            throw clientError(
                response.status === 413 ? 'BLOB_UPLOAD_TOO_LARGE' : 'BLOB_UPLOAD_FAILED',
                `BLOB upload failed with HTTP ${response.status}`,
                responseRequestId,
            );
        }
        const body = await readJson(response, responseRequestId);
        if (!isBlobUploadResponse(body)) {
            throw clientError(
                'INVALID_UPLOAD_RESPONSE',
                'The server returned an invalid BLOB upload response',
                responseRequestId,
            );
        }
        return body.value;
    }

    uploadedBlobUrl(token: string): string {
        return this.url(`/api/v1/uploads/blobs/${encodeURIComponent(token)}`);
    }

    async readUploadedBlob(token: string): Promise<Blob> {
        const session = await this.initialize();
        if (!session.capabilities.uploads) {
            throw clientError('UPLOADS_UNAVAILABLE', 'The server did not advertise file uploads');
        }
        const requestId = createRequestId();
        let response: Response;
        try {
            response = await this.fetchRequest(this.uploadedBlobUrl(token), {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                    accept: 'application/octet-stream',
                    'x-request-id': requestId,
                },
            });
        } catch (error) {
            throw normalizeTabularisError(error, 'UPLOAD_NETWORK_ERROR', requestId);
        }
        await this.checkSessionResponse(
            response,
            session,
            response.headers.get('x-request-id') ?? requestId,
        );
        if (!response.ok) {
            throw clientError(
                'BLOB_UPLOAD_READ_FAILED',
                `BLOB upload read failed with HTTP ${response.status}`,
                response.headers.get('x-request-id') ?? requestId,
            );
        }
        return response.blob();
    }

    async consumeBlobDownload(token: string): Promise<Blob> {
        const session = await this.initialize();
        if (!session.capabilities.downloads) {
            throw clientError(
                'DOWNLOADS_UNAVAILABLE',
                'The server did not advertise file downloads',
            );
        }
        const requestId = createRequestId();
        let response: Response;
        try {
            response = await this.fetchRequest(
                this.url(`/api/${session.apiVersion}/downloads/${encodeURIComponent(token)}`),
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        accept: 'application/octet-stream',
                        'x-request-id': requestId,
                    },
                },
            );
        } catch (error) {
            throw normalizeTabularisError(error, 'DOWNLOAD_NETWORK_ERROR', requestId);
        }
        const responseRequestId = response.headers.get('x-request-id') ?? requestId;
        await this.checkSessionResponse(response, session, responseRequestId);
        if (!response.ok) {
            throw clientError(
                'BLOB_DOWNLOAD_FAILED',
                `BLOB download failed with HTTP ${response.status}`,
                responseRequestId,
            );
        }
        return response.blob();
    }

    async subscribe<K extends EventName>(event: K, handler: EventHandler<K>): Promise<Unsubscribe> {
        const session = await this.initialize();
        if (!session.capabilities.events) {
            throw clientError(
                'EVENTS_UNAVAILABLE',
                'The server did not advertise WebSocket events',
            );
        }

        if (
            AUTHORIZATION_LEVELS.indexOf(session.access.authorizationLevel) <
            AUTHORIZATION_LEVELS.indexOf(EVENT_AUTHORIZATION[event])
        ) {
            throw clientError(
                'EVENT_FORBIDDEN',
                `The session is not authorized for event: ${event}`,
            );
        }

        const handlers = this.eventHandlers(event);
        const firstForEvent = handlers.size === 0;
        const wasConnected = this.socket?.readyState === OPEN;
        handlers.add(handler);
        this.intentionalClose = false;
        let ownPending: {resolve: () => void; reject: (error: unknown) => void} | undefined;
        const confirmation =
            firstForEvent || this.pendingSubscriptions.has(event)
                ? new Promise<void>((resolve, reject) => {
                      ownPending = {resolve, reject};
                      const pending = this.pendingSubscriptions.get(event) ?? [];
                      pending.push(ownPending);
                      this.pendingSubscriptions.set(event, pending);
                  })
                : Promise.resolve();

        try {
            await Promise.all([
                this.ensureConnected().then(() => {
                    if (firstForEvent && wasConnected && this.socket?.readyState === OPEN) {
                        this.sendControl({type: 'subscribe', events: [event]});
                    }
                }),
                confirmation,
            ]);
        } catch (error) {
            const normalized = normalizeTabularisError(error, 'EVENT_CONNECTION_FAILED');
            // Only this call failed; a newer subscription may already wait on a new socket.
            const pending = this.pendingSubscriptions.get(event);
            if (pending && ownPending) {
                const remaining = pending.filter((entry) => entry !== ownPending);
                if (remaining.length > 0) this.pendingSubscriptions.set(event, remaining);
                else this.pendingSubscriptions.delete(event);
            }
            this.removeSubscription(event, handler);
            throw normalized;
        }

        return () => this.removeSubscription(event, handler);
    }

    emit<K extends EventName>(_event: K, _payload: EventPayload<K>): Promise<void> {
        void _event;
        void _payload;
        return Promise.reject(
            clientError(
                'EVENT_EMIT_UNSUPPORTED',
                'Browser clients cannot publish application events',
            ),
        );
    }

    private async loadSession(): Promise<SessionNegotiation> {
        let response: Response;
        try {
            response = await this.fetchRequest(this.url('/api/v1/session'), {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {accept: 'application/json'},
            });
        } catch (error) {
            throw normalizeTabularisError(error, 'SESSION_NETWORK_ERROR');
        }

        const requestId = response.headers.get('x-request-id') ?? createRequestId();
        // Password mode answers a missing session with a redirect to its login form.
        if (response.redirected && new URL(response.url).pathname === LOGIN_PATH) {
            this.openLogin(this.url(LOGIN_PATH));
            throw clientError('LOGIN_REQUIRED', 'Log in to Tabularis Web again', requestId);
        }
        if (!response.ok) {
            throw clientError(
                response.status === 401 ? 'SESSION_REQUIRED' : 'SESSION_FAILED',
                response.status === 401
                    ? 'Open Tabularis Web using its one-time startup URL'
                    : `Session negotiation failed with HTTP ${response.status}`,
                requestId,
            );
        }

        const body = await readJson(response, requestId);
        if (!isSessionNegotiation(body)) {
            throw clientError(
                'INVALID_SESSION_RESPONSE',
                'The server returned an invalid session contract',
                requestId,
            );
        }
        if (!body.authenticated || body.csrfToken.length === 0) {
            throw clientError(
                'SESSION_REQUIRED',
                'The browser session is not authenticated',
                requestId,
            );
        }
        if (body.apiVersion !== EXPECTED_API_VERSION) {
            throw clientError(
                'UNSUPPORTED_API_VERSION',
                `Unsupported Web API version: ${body.apiVersion}`,
                requestId,
            );
        }
        if (!body.capabilities.rpc) {
            throw clientError(
                'RPC_UNAVAILABLE',
                'The server did not advertise RPC support',
                requestId,
            );
        }
        return body;
    }

    private async callRpc<ResponseBody>(
        command: string,
        request: unknown,
        options?: CommandCallOptions,
    ): Promise<ResponseBody> {
        const session = await this.initialize();
        const requestId = options?.requestId ?? createRequestId();
        const headers = new Headers({
            accept: 'application/json',
            'content-type': 'application/json',
            'x-request-id': requestId,
            'x-tabularis-csrf': session.csrfToken,
        });
        if (options?.deadlineMs !== undefined) {
            headers.set('x-tabularis-deadline-ms', String(options.deadlineMs));
        }
        if (options?.cancellationId !== undefined) {
            headers.set('x-tabularis-cancellation-id', options.cancellationId);
        }

        let response: Response;
        try {
            response = await this.fetchRequest(
                this.url(`/api/${session.apiVersion}/rpc/${encodeURIComponent(command)}`),
                {
                    method: 'POST',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers,
                    body: JSON.stringify(request ?? null),
                },
            );
        } catch (error) {
            throw normalizeTabularisError(error, 'NETWORK_ERROR', requestId);
        }

        const responseRequestId = response.headers.get('x-request-id') ?? requestId;
        await this.checkSessionResponse(response, session, responseRequestId);
        const body = await readJson(response, responseRequestId);
        if (!isRpcResponse(body)) {
            throw clientError(
                'INVALID_RPC_RESPONSE',
                'The server returned an invalid RPC response',
                responseRequestId,
            );
        }
        if (!body.ok) {
            throw new TabularisClientError(body.error);
        }
        if (!response.ok) {
            throw clientError(
                'HTTP_ERROR',
                `RPC request failed with HTTP ${response.status}`,
                responseRequestId,
            );
        }
        return body.data as ResponseBody;
    }

    /**
     * Drops a session the server no longer accepts and negotiates a new one: a
     * proxy issues it right away, a password deployment sends the user to its
     * login form. The rejected request is not repeated, since the server may
     * have stopped it halfway when the session expired.
     */
    private async renewSession(rejected: SessionNegotiation): Promise<void> {
        if (this.session === rejected) {
            this.session = undefined;
            this.sessionPromise = undefined;
            this.clearReconnectTimer();
            const socket = this.socket;
            this.socket = null;
            this.connectionPromise = null;
            this.lastSequence = 0;
            socket?.close();
        }
        await this.initialize();
        this.scheduleReconnect();
    }

    private async checkSessionResponse(
        response: Response,
        session: SessionNegotiation,
        requestId: string,
    ): Promise<void> {
        if (!isSessionRejection(response)) return;
        await this.renewSession(session);
        throw clientError(
            'SESSION_EXPIRED',
            'The session expired. Repeat the last action.',
            requestId,
        );
    }

    private async reconnect(): Promise<void> {
        const previous = this.session;
        const session = await this.loadSession();
        if (this.session === previous) {
            if (previous?.csrfToken !== session.csrfToken) this.lastSequence = 0;
            this.session = session;
            this.sessionPromise = undefined;
        }
        if (this.intentionalClose || this.subscribedEvents().length === 0) return;
        await this.ensureConnected();
    }

    private ensureConnected(): Promise<void> {
        if (this.socket?.readyState === OPEN) return Promise.resolve();
        if (this.connectionPromise) return this.connectionPromise;

        let created = false;
        const connection = new Promise<void>((resolve, reject) => {
            let connected = false;
            let socket: WebSocketLike;
            try {
                socket = this.createSocket(this.websocketUrl());
            } catch (error) {
                reject(normalizeTabularisError(error, 'EVENT_CONNECTION_FAILED'));
                this.scheduleReconnect();
                return;
            }
            created = true;
            this.socket = socket;
            // A socket closed by removeSubscription may still report events after a
            // new one replaced it; those must not touch the new socket's state.
            const current = () => this.socket === socket;
            const failBeforeOpen = (message: string) => {
                if (connected) return;
                if (this.connectionPromise === connection) this.connectionPromise = null;
                reject(clientError('EVENT_CONNECTION_FAILED', message));
            };

            socket.onopen = () => {
                if (!current()) {
                    socket.close();
                    return;
                }
                connected = true;
                this.reconnectAttempt = 0;
                this.connectionPromise = null;
                this.subscribeAll();
                resolve();
            };
            socket.onmessage = (message) => {
                if (current()) this.handleSocketMessage(message.data);
            };
            socket.onerror = () => {
                failBeforeOpen('The WebSocket event connection failed');
            };
            socket.onclose = () => {
                failBeforeOpen('The WebSocket event connection closed before opening');
                if (!current()) return;
                this.socket = null;
                this.rejectPendingSubscriptions(
                    clientError('EVENT_CONNECTION_FAILED', 'The WebSocket event connection closed'),
                );
                this.scheduleReconnect();
            };
        });
        if (created) this.connectionPromise = connection;
        return connection;
    }

    private subscribeAll(): void {
        const events = this.subscribedEvents();
        if (events.length === 0) return;
        this.sendControl({
            type: 'subscribe',
            events,
            ...(this.lastSequence > 0 ? {since: this.lastSequence} : {}),
        });
    }

    private removeSubscription<K extends EventName>(event: K, handler: EventHandler<K>): void {
        const handlers = this.handlers[event] as Set<EventHandler<K>> | undefined;
        if (!handlers) return;
        handlers.delete(handler);
        if (handlers.size > 0) return;
        delete this.handlers[event];

        if (this.socket?.readyState === OPEN) {
            this.sendControl({type: 'unsubscribe', events: [event]});
        }
        if (this.subscribedEvents().length === 0) {
            this.intentionalClose = true;
            this.clearReconnectTimer();
            this.socket?.close();
            this.socket = null;
            this.connectionPromise = null;
        }
    }

    private handleSocketMessage(data: unknown): void {
        if (typeof data !== 'string') return;
        let message: unknown;
        try {
            message = JSON.parse(data);
        } catch {
            return;
        }
        if (isRecord(message) && message.type === 'subscribed' && Array.isArray(message.events)) {
            for (const event of message.events) {
                if (typeof event !== 'string' || !this.isSubscribedEvent(event)) continue;
                this.pendingSubscriptions.get(event)?.forEach(({resolve}) => resolve());
                this.pendingSubscriptions.delete(event);
            }
            return;
        }
        if (
            isRecord(message) &&
            message.type === 'error' &&
            typeof message.code === 'string' &&
            typeof message.message === 'string'
        ) {
            const error = clientError(message.code, message.message);
            if (this.pendingSubscriptions.size === 0) {
                console.error('WebSocket subscription failed:', error);
            }
            this.rejectPendingSubscriptions(error);
            return;
        }
        if (!isServerEventMessage(message)) return;
        if (message.sequence <= this.lastSequence) return;
        this.lastSequence = message.sequence;
        if (!this.isSubscribedEvent(message.event)) return;
        this.deliverEvent(message.event, message.payload);
    }

    private rejectPendingSubscriptions(error: TabularisClientError): void {
        for (const pending of this.pendingSubscriptions.values()) {
            pending.forEach(({reject}) => reject(error));
        }
        this.pendingSubscriptions.clear();
    }

    private deliverEvent<K extends EventName>(event: K, payload: unknown): void {
        const handlers = this.handlers[event] as Set<EventHandler<K>> | undefined;
        if (!handlers) return;
        for (const handler of handlers) {
            handler(payload as EventPayload<K>);
        }
    }

    private isSubscribedEvent(event: string): event is EventName {
        return Object.prototype.hasOwnProperty.call(this.handlers, event);
    }

    private eventHandlers<K extends EventName>(event: K): Set<EventHandler<K>> {
        const existing = this.handlers[event] as Set<EventHandler<K>> | undefined;
        if (existing) return existing;
        const handlers = new Set<EventHandler<K>>();
        this.handlers[event] = handlers as EventHandlers[K];
        return handlers;
    }

    private subscribedEvents(): EventName[] {
        return Object.keys(this.handlers) as EventName[];
    }

    private sendControl(message: object): void {
        if (this.socket?.readyState === OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }

    private scheduleReconnect(): void {
        if (this.intentionalClose || this.subscribedEvents().length === 0 || this.reconnectTimer) {
            return;
        }
        const delay = Math.min(
            this.reconnectDelayMs * 2 ** this.reconnectAttempt,
            this.maxReconnectDelayMs,
        );
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.reconnect().catch(() => {
                this.scheduleReconnect();
            });
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    private websocketUrl(): string {
        const url = new URL('/api/v1/events', this.baseUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return url.toString();
    }

    private url(path: string): string {
        return new URL(path, this.baseUrl).toString();
    }
}

function encodeAssetPath(assetPath: string): string {
    return assetPath.split('/').map(encodeURIComponent).join('/');
}

const LOGIN_PATH = '/login';

/** The security gate rejects with an empty 401, or an empty 403 for a stale CSRF token. */
function isSessionRejection(response: Response): boolean {
    const json = response.headers.get('content-type')?.includes('application/json') ?? false;
    return (
        response.status === 401 ||
        (response.status === 403 && !json) ||
        (response.redirected && new URL(response.url).pathname === LOGIN_PATH)
    );
}

function openLogin(url: string): void {
    window.location.assign(url);
}

function startDownload(url: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    anchor.click();
}

function browserOrigin(): string {
    return typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
}

function normalizeBaseUrl(baseUrl: string): string {
    const url = new URL(baseUrl);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString();
}

async function readJson(response: Response, requestId: RequestId): Promise<unknown> {
    try {
        return await response.json();
    } catch (error) {
        throw normalizeTabularisError(error, 'INVALID_JSON_RESPONSE', requestId);
    }
}

function clientError(
    code: string,
    message: string,
    requestId: RequestId = createRequestId(),
    details: unknown | null = null,
): TabularisClientError {
    return new TabularisClientError({code, message, details, requestId});
}

function isFileTransferMetadata(value: unknown): value is FileTransferMetadata {
    return (
        isRecord(value) &&
        typeof value.token === 'string' &&
        value.token.length > 0 &&
        typeof value.fileName === 'string' &&
        value.fileName.length > 0 &&
        typeof value.mimeType === 'string' &&
        value.mimeType.length > 0 &&
        typeof value.size === 'number' &&
        Number.isSafeInteger(value.size) &&
        value.size >= 0 &&
        typeof value.expiresAt === 'string' &&
        value.expiresAt.length > 0
    );
}

function isBlobUploadResponse(value: unknown): value is {value: string} {
    return (
        typeof value === 'object' &&
        value !== null &&
        'value' in value &&
        typeof value.value === 'string' &&
        value.value.startsWith('BLOB_UPLOAD_REF:')
    );
}

function isIconUploadResponse(value: unknown): value is {token: string} {
    return (
        typeof value === 'object' &&
        value !== null &&
        'token' in value &&
        typeof value.token === 'string' &&
        value.token.length > 0
    );
}

function isSessionNegotiation(value: unknown): value is SessionNegotiation {
    if (
        !isRecord(value) ||
        !isRecord(value.capabilities) ||
        !isRecord(value.serverBuild) ||
        !isRecord(value.access) ||
        !isRecord(value.queryResponsePolicy)
    ) {
        return false;
    }
    const capabilities = value.capabilities;
    const serverBuild = value.serverBuild;
    const access = value.access;
    const queryPolicy = value.queryResponsePolicy;
    return (
        typeof value.apiVersion === 'string' &&
        typeof value.serverVersion === 'string' &&
        typeof serverBuild.target === 'string' &&
        serverBuild.target.length > 0 &&
        (serverBuild.profile === 'debug' || serverBuild.profile === 'release') &&
        (serverBuild.commit === null || typeof serverBuild.commit === 'string') &&
        typeof value.authenticated === 'boolean' &&
        typeof value.csrfToken === 'string' &&
        typeof access.remote === 'boolean' &&
        isAuthorizationLevel(access.authorizationLevel) &&
        typeof access.highRiskCapabilities === 'boolean' &&
        typeof capabilities.rpc === 'boolean' &&
        typeof capabilities.events === 'boolean' &&
        typeof capabilities.uploads === 'boolean' &&
        typeof capabilities.downloads === 'boolean' &&
        typeof capabilities.pluginAssets === 'boolean' &&
        typeof capabilities.mcpHostConfiguration === 'boolean' &&
        capabilities.nativeUpdater === false &&
        typeof queryPolicy.maxRowsPerPage === 'number' &&
        Number.isSafeInteger(queryPolicy.maxRowsPerPage) &&
        queryPolicy.maxRowsPerPage > 0 &&
        typeof queryPolicy.maxResponseBytes === 'number' &&
        Number.isSafeInteger(queryPolicy.maxResponseBytes) &&
        queryPolicy.maxResponseBytes > 0 &&
        typeof queryPolicy.streaming === 'boolean'
    );
}

function isAuthorizationLevel(value: unknown): boolean {
    return (
        value === 'session' ||
        value === 'database' ||
        value === 'sensitive' ||
        value === 'local-admin'
    );
}

function isRpcResponse(value: unknown): value is RpcResponse<unknown> {
    if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
    if (value.ok) return 'data' in value;
    return isTabularisError(value.error);
}

function isTabularisError(value: unknown): value is TabularisError {
    return (
        isRecord(value) &&
        typeof value.code === 'string' &&
        typeof value.message === 'string' &&
        'details' in value &&
        typeof value.requestId === 'string'
    );
}

function isServerEventMessage(value: unknown): value is ServerEventMessage {
    return (
        isRecord(value) &&
        value.type === 'event' &&
        typeof value.event === 'string' &&
        'payload' in value &&
        typeof value.sequence === 'number' &&
        Number.isSafeInteger(value.sequence) &&
        value.sequence > 0
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
