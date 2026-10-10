import { getActivePlatformCapabilitiesOrNull } from "../platform/activeCapabilities";

export const DEFAULT_NOTIFY_THRESHOLD_SEC = 20;

export interface QueryNotificationContent {
  title: string;
  body: string;
}

interface ShouldNotifyQueryFinishedOptions {
  /** Undefined counts as enabled (the setting defaults to on). */
  enabled: boolean | undefined;
  /** Undefined, non-finite or <= 0 falls back to DEFAULT_NOTIFY_THRESHOLD_SEC. */
  thresholdSec: number | undefined;
  durationMs: number;
  windowFocused: boolean;
}

export function shouldNotifyQueryFinished(
  opts: ShouldNotifyQueryFinishedOptions,
): boolean {
  if (opts.enabled === false) return false;
  if (opts.windowFocused) return false;

  const thresholdSec =
    opts.thresholdSec !== undefined &&
    Number.isFinite(opts.thresholdSec) &&
    opts.thresholdSec > 0
      ? opts.thresholdSec
      : DEFAULT_NOTIFY_THRESHOLD_SEC;

  return opts.durationMs >= thresholdSec * 1000;
}

interface NotifyQueryFinishedOptions {
  enabled?: boolean;
  thresholdSec?: number;
  durationMs: number;
  content: QueryNotificationContent;
}

export async function notifyQueryFinished(
  opts: NotifyQueryFinishedOptions,
): Promise<void> {
  try {
    const platform = getActivePlatformCapabilitiesOrNull();
    if (!platform) return;
    let windowFocused: boolean;
    try {
      windowFocused = document.hasFocus();
    } catch {
      // The focus probe rejecting must not suppress the notification: treat
      // the window as unfocused so a long query still reports its result.
      windowFocused = false;
    }

    const shouldNotify = shouldNotifyQueryFinished({
      enabled: opts.enabled,
      thresholdSec: opts.thresholdSec,
      durationMs: opts.durationMs,
      windowFocused,
    });
    if (!shouldNotify) return;

    await platform.notify(opts.content);
  } catch {
    // A notification problem must never break query execution.
  }
}
