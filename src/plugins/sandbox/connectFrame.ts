import {convertFileSrc} from '@tauri-apps/api/core';
import {RpcPort} from './rpc';

const PLUGIN_BASE = convertFileSrc('x', 'tabularis-plugin').slice(0, -1);

export function pluginFrameUrl(
    pluginId: string,
    modulePath: string,
    mode: 'ui' | 'explain' = 'ui',
): string {
    const query = new URLSearchParams({module: modulePath, mode});
    return `${PLUGIN_BASE}${encodeURIComponent(pluginId)}/__guest__.html?${query}`;
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
