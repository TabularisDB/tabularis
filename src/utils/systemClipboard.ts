import {readText, writeHtml, writeText} from '@tauri-apps/plugin-clipboard-manager';

// The clipboard plugin (arboard) reaches Wayland only through the wlr/ext data-control
// protocols, which compositors such as Niri withhold from sandboxed (Flatpak) clients;
// arboard then falls back to X11 and fails. The webview clipboard goes through the window's
// own Wayland data device, so every operation falls back to it. Reading through the webview
// can make WebKitGTK ask for confirmation, which is why the plugin stays the first choice.

async function withWebviewFallback<T>(
    viaPlugin: () => Promise<T>,
    viaWebview: () => Promise<T>,
): Promise<T> {
    try {
        return await viaPlugin();
    } catch (pluginError) {
        console.warn('Clipboard plugin failed, using the webview clipboard:', pluginError);
        return viaWebview();
    }
}

/** Reads plain text from the system clipboard. Rejects when neither backend can read it. */
export function readClipboardText(): Promise<string> {
    return withWebviewFallback(
        () => readText(),
        () => navigator.clipboard.readText(),
    );
}

/** Writes plain text to the system clipboard. Rejects when neither backend can write it. */
export function writeClipboardText(text: string): Promise<void> {
    return withWebviewFallback(
        () => writeText(text),
        () => navigator.clipboard.writeText(text),
    );
}

/**
 * Writes HTML with a plain-text flavor. Without `ClipboardItem` in the webview, the fallback
 * writes the plain text only.
 */
export function writeClipboardHtml(html: string, plainText: string): Promise<void> {
    return withWebviewFallback(
        () => writeHtml(html, plainText),
        () => {
            if (typeof ClipboardItem === 'undefined') {
                return navigator.clipboard.writeText(plainText);
            }
            return navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], {type: 'text/html'}),
                    'text/plain': new Blob([plainText], {type: 'text/plain'}),
                }),
            ]);
        },
    );
}
