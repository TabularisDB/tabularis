/**
 * Detects if a value is a raw SQL function call (e.g., ST_GeomFromText(...))
 * rather than a simple WKT string (e.g., POINT(1 2))
 * 
 * A raw SQL function must start with ST_ prefix or specific SQL function names
 * Simple WKT like "POINT(1 2)" is NOT considered a raw SQL function
 */
export function isRawSqlFunction(value: string): boolean {
  if (!value || value.trim() === "") return false;
  const trimmed = value.trim().toUpperCase();
  
  // Check for ST_ prefix followed by parenthesis (e.g., ST_GeomFromText(...))
  if (trimmed.startsWith("ST_") && trimmed.includes('(')) {
    return true;
  }
  
  // Check for legacy function names (these are actual SQL functions, not WKT)
  // Note: POINT( is NOT a SQL function, it's WKT format
  return trimmed.startsWith("GEOMFROMTEXT(") ||
         trimmed.startsWith("GEOMFROMWKB(") ||
         trimmed.startsWith("POINTFROMTEXT(") ||
         trimmed.startsWith("POINTFROMWKB(") ||
         trimmed.startsWith("LINESTRINGFROMTEXT(") ||
         trimmed.startsWith("POLYGONFROMTEXT(");
}

/**
 * Extracts WKT from a SQL function call if present
 * @param value - The SQL function string
 * @returns The extracted WKT or null if not found
 */
export function extractWktFromSql(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/ST_GeomFromText\s*\(\s*['"](.+?)['"]\s*(?:,\s*\d+\s*)?\)/i);
  return match ? match[1] : null;
}

/**
 * Wraps a WKT string in ST_GeomFromText function
 * @param wkt - The WKT string
 * @param srid - Optional SRID (default: undefined)
 * @returns SQL function string
 */
export function wrapWktInFunction(wkt: string, srid?: number): string {
  if (!wkt || wkt.trim() === "") return wkt;
  const trimmed = wkt.trim();
  
  // Already a function? Return as-is
  if (isRawSqlFunction(trimmed)) return trimmed;
  
  // Wrap in ST_GeomFromText
  if (srid !== undefined) {
    return `ST_GeomFromText('${trimmed}', ${srid})`;
  }
  return `ST_GeomFromText('${trimmed}')`;
}

/**
 * Gets appropriate placeholder text based on mode and data type
 */
export function getGeometryPlaceholder(isRawSqlMode: boolean): string {
  if (isRawSqlMode) {
    return "ST_GeomFromText('POINT(30 40)', 4326)";
  }
  return "POINT(30 40)";
}

/**
 * Gets helper text for the current mode
 */
export function getGeometryHelperText(isRawSqlMode: boolean): string {
  if (isRawSqlMode) {
    return "Inserisci una funzione SQL completa (es: ST_GeomFromText('POINT(30 40)', 4326))";
  }
  return "Inserisci formato WKT (es: POINT(30 40))";
}

/**
 * Validates if a string looks like valid WKT format
 */
export function isValidWkt(value: string): boolean {
  if (!value || value.trim() === "") return false;
  const wktPattern = /^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*\(/i;
  return wktPattern.test(value.trim());
}

/**
 * Toggles between simple WKT mode and raw SQL mode
 * @param currentValue - Current input value
 * @param targetMode - Target mode (true = raw SQL, false = simple WKT)
 * @returns The converted value
 */
export function toggleGeometryMode(currentValue: string, targetMode: boolean): string {
  if (targetMode) {
    // Switching to raw SQL mode
    const trimmed = currentValue.trim();
    if (trimmed && !isRawSqlFunction(trimmed)) {
      // Check if it looks like WKT
      if (isValidWkt(trimmed)) {
        return wrapWktInFunction(trimmed);
      }
    }
    return trimmed;
  } else {
    // Switching to simple mode - extract WKT from SQL function
    const extracted = extractWktFromSql(currentValue);
    return extracted || currentValue;
  }
}
