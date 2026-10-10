import { Geometry } from "wkx";
// Use Node.js Buffer if available (tests), otherwise use polyfill (browser)
import { Buffer as BufferPolyfill } from "buffer";
const BufferImpl = typeof Buffer !== "undefined" ? Buffer : BufferPolyfill;

/**
 * Checks if a value is a WKB (Well-Known Binary) hex string
 * WKB hex strings start with "0x" followed by hexadecimal characters
 */
export function isWkbHexString(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  // WKB hex strings start with 0x or 0X followed by hex characters
  return /^0[xX][0-9A-Fa-f]+$/.test(value);
}

/**
 * Checks if a data type is a geometric type
 * Supports MySQL, PostgreSQL/PostGIS geometric types
 */
export function isGeometricType(dataType: string): boolean {
  if (!dataType) {
    return false;
  }

  const normalizedType = dataType.toUpperCase();

  // Common geometric types across different databases
  const geometricTypes = [
    "GEOMETRY",
    "POINT",
    "LINESTRING",
    "POLYGON",
    "MULTIPOINT",
    "MULTILINESTRING",
    "MULTIPOLYGON",
    "GEOMETRYCOLLECTION",
    "GEOGRAPHY", // PostgreSQL PostGIS
  ];

  return geometricTypes.some((type) => normalizedType.includes(type));
}

/**
 * Converts a WKB hex string to WKT (Well-Known Text) format
 * @param hexString - The WKB hex string (e.g., "0x0101000000...")
 * @returns WKT string (e.g., "POINT(1.234 5.678)")
 * @throws Error if parsing fails
 */
export function wkbHexToWkt(hexString: string): string {
  // Remove "0x" prefix if present
  let hex =
    hexString.startsWith("0x") || hexString.startsWith("0X")
      ? hexString.substring(2)
      : hexString;

  // MySQL includes 4-byte SRID prefix before standard WKB
  // Check if this looks like MySQL format (starts with 00000000 or similar SRID)
  // Standard WKB starts with byte order (01 or 00) which is just 2 hex chars
  // If we have more than 2 chars before the geometry type, it's likely SRID + WKB
  if (hex.length > 10) {
    // Skip first 8 hex chars (4 bytes) which represent the SRID in MySQL
    hex = hex.substring(8);
  }

  // Convert hex string to Buffer
  const buffer = BufferImpl.from(hex, "hex");

  // Parse WKB and convert to WKT
  const geometry = Geometry.parse(buffer);
  return geometry.toWkt();
}

/**
 * Formats a geometric value for display
 * Handles both WKB (MySQL) and WKT (PostgreSQL) formats
 * @param value - The geometric value to format
 * @returns Formatted string representation
 */
export function formatGeometricValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  const stringValue = String(value);

  // If it's already in WKT format (contains geometric type names), return as-is
  const wktPattern =
    /^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)/i;
  if (wktPattern.test(stringValue)) {
    return stringValue;
  }

  // If it's a WKB hex string, convert to WKT
  if (isWkbHexString(value)) {
    try {
      return wkbHexToWkt(stringValue);
    } catch (error) {
      console.warn("Failed to parse WKB hex string:", stringValue, error);
      // Fallback to original string if parsing fails
      return stringValue;
    }
  }

  // For other formats, return as-is
  return stringValue;
}
