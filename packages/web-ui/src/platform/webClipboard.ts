/** The webview's own clipboard (`navigator.clipboard`). Every function rejects with the raw error. */

const unavailable = () => new DOMException('Clipboard access is unavailable', 'NotAllowedError');

export async function readWebClipboardText(): Promise<string> {
    if (!navigator.clipboard?.readText) throw unavailable();
    return navigator.clipboard.readText();
}

export async function writeWebClipboardText(text: string): Promise<void> {
    if (!navigator.clipboard?.writeText) throw unavailable();
    await navigator.clipboard.writeText(text);
}

/** Writes HTML with a plain-text flavor, or only `altText` when `ClipboardItem` is unavailable. */
export async function writeWebClipboardHtml(html: string, altText: string): Promise<void> {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        return writeWebClipboardText(altText);
    }
    await navigator.clipboard.write([
        new ClipboardItem({
            'text/html': new Blob([html], {type: 'text/html'}),
            'text/plain': new Blob([altText], {type: 'text/plain'}),
        }),
    ]);
}
