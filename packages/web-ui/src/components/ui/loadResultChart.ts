let request: Promise<typeof import('./ResultChart')> | undefined;

/**
 * Loads the result chart, and Recharts with it, in its own chunk. Grid-only
 * panels, such as a detached results window nobody switches to Chart, never
 * fetch it. Later calls share the request; a failed one can be retried.
 */
export function loadResultChart(): Promise<typeof import('./ResultChart')> {
    request ??= import('./ResultChart').catch((error: unknown) => {
        request = undefined;
        throw error;
    });
    return request;
}

/** Starts loading the chart ahead of a likely switch to Chart view. */
export function preloadResultChart(): void {
    // A failed preload is retried when the chart is actually shown.
    loadResultChart().catch(() => {});
}
