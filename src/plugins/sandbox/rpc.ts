export type RpcHandler = (method: string, params: unknown) => unknown | Promise<unknown>;

const RPC_TIMEOUT_MS = 30_000;

interface PendingCall {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeoutId: number;
}

/** Request/response RPC for the single MessagePort shared with one plugin frame. */
export class RpcPort {
    private nextId = 0;
    private pending = new Map<number, PendingCall>();
    private readonly port: MessagePort;
    private readonly handler: RpcHandler;

    constructor(port: MessagePort, handler: RpcHandler) {
        this.port = port;
        this.handler = handler;
        port.onmessage = (event: MessageEvent<unknown>) => {
            const message = event.data as Record<string, unknown> | null;
            if (!message || typeof message !== 'object') return;

            if (message.kind === 'response' && typeof message.id === 'number') {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                window.clearTimeout(pending.timeoutId);
                if (typeof message.error === 'string') pending.reject(new Error(message.error));
                else pending.resolve(message.result);
                return;
            }

            if (
                message.kind === 'request' &&
                typeof message.id === 'number' &&
                typeof message.method === 'string'
            ) {
                void this.respond(message.id, message.method, message.params);
            }
        };
        port.start();
    }

    call(method: string, params: unknown[] = [], timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Plugin RPC timed out: ${method}`));
            }, timeoutMs);
            this.pending.set(id, {resolve, reject, timeoutId});
            try {
                this.port.postMessage({kind: 'request', id, method, params});
            } catch (error) {
                window.clearTimeout(timeoutId);
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    close(): void {
        this.port.close();
        for (const call of this.pending.values()) {
            window.clearTimeout(call.timeoutId);
            call.reject(new Error('Plugin frame closed'));
        }
        this.pending.clear();
    }

    private async respond(id: number, method: string, params: unknown): Promise<void> {
        try {
            const result = await this.handler(method, params);
            this.port.postMessage({kind: 'response', id, result});
        } catch (error) {
            this.port.postMessage({
                kind: 'response',
                id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
