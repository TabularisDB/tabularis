interface RestoreSessionOptions {
  connectionIds: string[];
  activeId: string | null;
  connect: (id: string, options: { activate: boolean }) => Promise<void>;
  onForegroundStart: (id: string) => void;
  onForegroundReady: () => void;
  onError: (id: string, error: unknown) => void;
}

/** Prefer the last active connection; the remaining session cannot steal focus. */
export async function restoreSession(options: RestoreSessionOptions): Promise<void> {
  const ids = [...new Set(options.connectionIds)];
  if (options.activeId && ids.includes(options.activeId)) {
    ids.splice(ids.indexOf(options.activeId), 1);
    ids.unshift(options.activeId);
  }
  let foregroundReady = false;
  for (const id of ids) {
    if (!foregroundReady) options.onForegroundStart(id);
    try {
      await options.connect(id, { activate: !foregroundReady });
      if (!foregroundReady) {
        foregroundReady = true;
        options.onForegroundReady();
      }
    } catch (error) {
      options.onError(id, error);
    }
  }
}
