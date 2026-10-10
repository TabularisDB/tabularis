/**
 * Safely extracts an error message from an unknown caught value.
 *
 * Handles Error instances, plain strings, and arbitrary types
 * without unsafe casts.
 */
export function toErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  // Tauri invoke errors are often serialised as plain objects with a message field
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as Record<string, unknown>).message === "string"
  ) {
    return (err as Record<string, unknown>).message as string;
  }
  return String(err);
}

/**
 * Separator used when composing a user-facing error banner as
 * `${summary}\n\nError: ${technicalDetail}`.
 */
const ERROR_DETAILS_MARKER = "\n\nError: ";

/**
 * Splits a composed error banner message into its human-readable summary
 * and the (optional) technical detail that follows the `Error:` marker.
 *
 * When the marker is absent the whole message is treated as the summary
 * and `details` is `null`.
 */
export function splitErrorDetails(message: string): {
  summary: string;
  details: string | null;
} {
  const idx = message.indexOf(ERROR_DETAILS_MARKER);
  if (idx === -1) return { summary: message, details: null };
  const details = message.slice(idx + ERROR_DETAILS_MARKER.length).trim();
  return {
    summary: message.slice(0, idx),
    details: details.length > 0 ? details : null,
  };
}
