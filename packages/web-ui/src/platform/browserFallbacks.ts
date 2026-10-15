export const BROWSER_CAPABILITY_FALLBACK_EVENT =
  "tabularis:browser-capability-fallback";

export type BrowserCapabilityFallback =
  | {
      readonly kind: "notification";
      readonly title: string;
      readonly body?: string;
    }
  | {
      readonly kind: "external-url";
      readonly url: string;
    };

export type BrowserCapabilityFallbackHandler = (
  fallback: BrowserCapabilityFallback,
) => void;

export function publishBrowserCapabilityFallback(
  fallback: BrowserCapabilityFallback,
): void {
  window.dispatchEvent(
    new CustomEvent<BrowserCapabilityFallback>(
      BROWSER_CAPABILITY_FALLBACK_EVENT,
      { detail: fallback },
    ),
  );
}

export function subscribeBrowserCapabilityFallbacks(
  handler: BrowserCapabilityFallbackHandler,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<BrowserCapabilityFallback>).detail);
  };
  window.addEventListener(BROWSER_CAPABILITY_FALLBACK_EVENT, listener);
  return () =>
    window.removeEventListener(BROWSER_CAPABILITY_FALLBACK_EVENT, listener);
}
