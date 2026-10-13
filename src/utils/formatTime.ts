/**
 * Format milliseconds into a human-readable duration string
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "45 ms", "1.23 s", "2 min 30 s")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${(ms / 1000).toFixed(2)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} min ${remainingSeconds} s`;
}

/**
 * Parse a formatted duration string back to milliseconds (approximate)
 * Useful for testing or reverse operations
 * @param formatted - Formatted string (e.g., "45 ms", "1.23 s", "2 min 30 s")
 * @returns Approximate milliseconds
 */
export function parseDuration(formatted: string): number {
  const trimmed = formatted.trim();
  
  // Match "45 ms" or "45ms"
  const msMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*ms$/i);
  if (msMatch) {
    return Math.round(parseFloat(msMatch[1]));
  }
  
  // Match "1.23 s" or "1.23s"
  const sMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (sMatch) {
    return Math.round(parseFloat(sMatch[1]) * 1000);
  }
  
  // Match "2 min 30 s" or "2min 30s"
  const minSecMatch = trimmed.match(/^(\d+)\s*min\s*(\d+)\s*s$/i);
  if (minSecMatch) {
    const minutes = parseInt(minSecMatch[1], 10);
    const seconds = parseInt(minSecMatch[2], 10);
    return (minutes * 60 + seconds) * 1000;
  }
  
  // Match just minutes "2 min"
  const minMatch = trimmed.match(/^(\d+)\s*min$/i);
  if (minMatch) {
    return parseInt(minMatch[1], 10) * 60 * 1000;
  }
  
  return 0;
}

/**
 * Format elapsed seconds into MM:SS format
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "00:05", "02:30", "15:42")
 */
export function formatElapsedTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export interface TimingBreakdown {
  serverTimeMs?: number | null;
  fetchTimeMs?: number | null;
  totalTimeMs?: number | null;
}

export interface TimingLabels {
  execution?: string;
  fetch?: string;
  total?: string;
}

/**
 * Builds a tooltip string breaking down execution and fetch times when available.
 * Returns null if neither serverTimeMs nor fetchTimeMs is present.
 */
export function formatTimingTooltip(
  breakdown: TimingBreakdown,
  labels: TimingLabels = {},
): string | null {
  const { serverTimeMs, fetchTimeMs, totalTimeMs } = breakdown;
  if (serverTimeMs === null || serverTimeMs === undefined) {
    if (fetchTimeMs === null || fetchTimeMs === undefined) {
      return null;
    }
  }

  const execLabel = labels.execution ?? "Execution";
  const fetchLabel = labels.fetch ?? "Fetch";
  const totalLabel = labels.total ?? "Total";

  const parts: string[] = [];
  if (serverTimeMs !== null && serverTimeMs !== undefined) {
    parts.push(`${execLabel}: ${formatDuration(serverTimeMs)}`);
  }
  if (fetchTimeMs !== null && fetchTimeMs !== undefined) {
    parts.push(`${fetchLabel}: ${formatDuration(fetchTimeMs)}`);
  }
  const effectiveTotal =
    totalTimeMs !== null && totalTimeMs !== undefined
      ? totalTimeMs
      : serverTimeMs !== null && serverTimeMs !== undefined && fetchTimeMs !== null && fetchTimeMs !== undefined
        ? serverTimeMs + fetchTimeMs
        : null;
  if (effectiveTotal !== null && effectiveTotal !== undefined) {
    parts.push(`${totalLabel}: ${formatDuration(effectiveTotal)}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

