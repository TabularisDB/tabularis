import {getActivePlatformCapabilities} from '@/platform/activeCapabilities';
import {RpcPort} from './rpc';

export async function pluginFrameUrl(
    pluginId: string,
    modulePath: string,
    mode: 'ui' | 'explain' = 'ui',
): Promise<string> {
    const query = new URLSearchParams({module: modulePath, mode});
    const base = getActivePlatformCapabilities().pluginFrameBaseUrl();
    if (base === '/api/v1/sandbox/plugins/') {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15_000);
        let response: Response;
        try {
            response = await fetch(`/api/v1/sandbox-ticket/${encodeURIComponent(pluginId)}`, {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: controller.signal,
            });
        } finally {
            window.clearTimeout(timeout);
        }
        if (!response.ok) throw new Error(`Plugin sandbox access failed (${response.status})`);
        const payload: unknown = await response.json();
        if (
            !payload ||
            typeof payload !== 'object' ||
            !('baseUrl' in payload) ||
            typeof payload.baseUrl !== 'string' ||
            !payload.baseUrl.startsWith('/api/v1/sandbox/plugins/') ||
            !payload.baseUrl.endsWith(`/${encodeURIComponent(pluginId)}/`)
        )
            throw new Error('Invalid plugin sandbox access response');
        return `${payload.baseUrl}__guest__.html?${query}`;
    }
    return `${base}${encodeURIComponent(pluginId)}/__guest__.html?${query}`;
}

export type PluginHostHandler = (...args: unknown[]) => unknown | Promise<unknown>;

export function connectFrame(
    frame: HTMLIFrameElement,
    handlers: Record<string, PluginHostHandler>,
    signal: AbortSignal,
): Promise<RpcPort> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            window.removeEventListener('message', onReady);
            signal.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(new DOMException('Plugin frame connection aborted', 'AbortError'));
        };
        const onReady = (event: MessageEvent) => {
            if (event.source !== frame.contentWindow || event.data?.type !== 'tabularis:ready')
                return;
            cleanup();
            const {port1, port2} = new MessageChannel();
            const rpc = new RpcPort(port1, async (method, params) => {
                if (!Object.hasOwn(handlers, method)) throw new Error('method_not_allowed');
                const args = Array.isArray(params) ? params : [params];
                return handlers[method](...args);
            });
            // Sandboxed frames have an opaque origin; the source window is checked above
            // and the transferred port is unique to this frame instance.
            frame.contentWindow?.postMessage({type: 'tabularis:init'}, '*', [port2]);
            resolve(rpc);
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, {once: true});
        window.addEventListener('message', onReady);
    });
}
