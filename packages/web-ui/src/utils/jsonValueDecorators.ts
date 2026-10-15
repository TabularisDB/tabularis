/**
 * Helpers for recognizing links and CSS colors in string values (e.g. for JSON viewer)
 */

const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const MAILTO_REGEX = /^mailto:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR_REGEX = /^rgba?\(\s*([0-9]{1,3}%?)\s*,\s*([0-9]{1,3}%?)\s*,\s*([0-9]{1,3}%?)\s*(?:,\s*([0-9.]+%?)\s*)?\)$/i;
const HSL_COLOR_REGEX = /^hsla?\(\s*([0-9.]+(?:deg|rad|turn)?)\s*,\s*([0-9.]+%)\s*,\s*([0-9.]+%)\s*(?:,\s*([0-9.]+%?)\s*)?\)$/i;

/**
 * Returns true if the string represents an absolute HTTP/HTTPS URL or mailto: link.
 */
export function isLinkString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return URL_REGEX.test(trimmed) || MAILTO_REGEX.test(trimmed);
}

/**
 * Returns true if the string represents a valid CSS color (hex, rgb/rgba, or hsl/hsla).
 */
export function isColorString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    HEX_COLOR_REGEX.test(trimmed) ||
    RGB_COLOR_REGEX.test(trimmed) ||
    HSL_COLOR_REGEX.test(trimmed)
  );
}
