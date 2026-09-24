import { describe, it, expect } from 'vitest';
import {
  isRawSqlFunction,
  extractWktFromSql,
  wrapWktInFunction,
  getGeometryPlaceholder,
  getGeometryHelperText,
  isValidWkt,
  toggleGeometryMode,
} from '../../src/utils/geometryInput';

describe('isRawSqlFunction', () => {
  it('should return false for empty string', () => {
    expect(isRawSqlFunction('')).toBe(false);
    expect(isRawSqlFunction('   ')).toBe(false);
  });

  it('should return false for simple WKT', () => {
    expect(isRawSqlFunction('POINT(1 2)')).toBe(false);
    expect(isRawSqlFunction('LINESTRING(1 2, 3 4)')).toBe(false);
    expect(isRawSqlFunction('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')).toBe(false);
  });

  it('should return true for ST_GeomFromText', () => {
    expect(isRawSqlFunction("ST_GeomFromText('POINT(1 2)')")).toBe(true);
    expect(isRawSqlFunction("ST_GeomFromText('POINT(1 2)', 4326)")).toBe(true);
    expect(isRawSqlFunction("st_geomfromtext('POINT(1 2)')")).toBe(true); // case insensitive
  });

  it('should return true for other ST_ functions', () => {
    expect(isRawSqlFunction('ST_MakePoint(1, 2)')).toBe(true);
    expect(isRawSqlFunction('ST_GeomFromWKB(0x0101000000)')).toBe(true);
    expect(isRawSqlFunction('ST_SetSRID(ST_MakePoint(1, 2), 4326)')).toBe(true);
  });

  it('should return true for legacy GeomFromText', () => {
    expect(isRawSqlFunction("GeomFromText('POINT(1 2)')")).toBe(true);
  });
});

describe('extractWktFromSql', () => {
  it('should return null for empty string', () => {
    expect(extractWktFromSql('')).toBeNull();
  });

  it('should extract WKT from ST_GeomFromText without SRID', () => {
    expect(extractWktFromSql("ST_GeomFromText('POINT(1 2)')")).toBe('POINT(1 2)');
    expect(extractWktFromSql("ST_GeomFromText('LINESTRING(1 2, 3 4)')")).toBe('LINESTRING(1 2, 3 4)');
  });

  it('should extract WKT from ST_GeomFromText with SRID', () => {
    expect(extractWktFromSql("ST_GeomFromText('POINT(1 2)', 4326)")).toBe('POINT(1 2)');
    expect(extractWktFromSql("ST_GeomFromText('POINT(1 2)',4326)")).toBe('POINT(1 2)');
  });

  it('should handle case insensitive', () => {
    expect(extractWktFromSql("st_geomfromtext('POINT(1 2)')")).toBe('POINT(1 2)');
    expect(extractWktFromSql("St_GeomFromText('POINT(1 2)')")).toBe('POINT(1 2)');
  });

  it('should handle double quotes', () => {
    expect(extractWktFromSql('ST_GeomFromText("POINT(1 2)")')).toBe('POINT(1 2)');
  });

  it('should return null for non-matching strings', () => {
    expect(extractWktFromSql('POINT(1 2)')).toBeNull();
    expect(extractWktFromSql('ST_MakePoint(1, 2)')).toBeNull();
  });
});

describe('wrapWktInFunction', () => {
  it('should return empty string for empty input', () => {
    expect(wrapWktInFunction('')).toBe('');
  });

  it('should wrap simple WKT without SRID', () => {
    expect(wrapWktInFunction('POINT(1 2)')).toBe("ST_GeomFromText('POINT(1 2)')");
    expect(wrapWktInFunction('LINESTRING(1 2, 3 4)')).toBe("ST_GeomFromText('LINESTRING(1 2, 3 4)')");
  });

  it('should wrap simple WKT with SRID', () => {
    expect(wrapWktInFunction('POINT(1 2)', 4326)).toBe("ST_GeomFromText('POINT(1 2)', 4326)");
  });

  it('should return as-is if already a function', () => {
    const sql = "ST_GeomFromText('POINT(1 2)', 4326)";
    expect(wrapWktInFunction(sql)).toBe(sql);
  });

  it('should handle whitespace', () => {
    expect(wrapWktInFunction('  POINT(1 2)  ')).toBe("ST_GeomFromText('POINT(1 2)')");
  });
});

describe('getGeometryPlaceholder', () => {
  it('should return SQL placeholder for raw SQL mode', () => {
    expect(getGeometryPlaceholder(true)).toContain('ST_GeomFromText');
    expect(getGeometryPlaceholder(true)).toContain('4326');
  });

  it('should return WKT placeholder for simple mode', () => {
    expect(getGeometryPlaceholder(false)).toBe('POINT(30 40)');
  });
});

describe('getGeometryHelperText', () => {
  it('should return SQL helper for raw SQL mode', () => {
    const text = getGeometryHelperText(true);
    expect(text).toContain('SQL');
    expect(text).toContain('ST_GeomFromText');
  });

  it('should return WKT helper for simple mode', () => {
    const text = getGeometryHelperText(false);
    expect(text).toContain('WKT');
    expect(text).toContain('POINT');
  });
});

describe('isValidWkt', () => {
  it('should return false for empty string', () => {
    expect(isValidWkt('')).toBe(false);
  });

  it('should return true for valid POINT', () => {
    expect(isValidWkt('POINT(1 2)')).toBe(true);
    expect(isValidWkt('POINT(1.5 2.5)')).toBe(true);
    expect(isValidWkt('POINT(1 2 3)')).toBe(true);
  });

  it('should return true for valid LINESTRING', () => {
    expect(isValidWkt('LINESTRING(1 2, 3 4)')).toBe(true);
    expect(isValidWkt('LINESTRING(1 2, 3 4, 5 6)')).toBe(true);
  });

  it('should return true for valid POLYGON', () => {
    expect(isValidWkt('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')).toBe(true);
  });

  it('should return true for other valid types', () => {
    expect(isValidWkt('MULTIPOINT(1 2, 3 4)')).toBe(true);
    expect(isValidWkt('MULTILINESTRING((1 2, 3 4))')).toBe(true);
    expect(isValidWkt('MULTIPOLYGON(((0 0, 1 0, 1 1, 0 1, 0 0)))')).toBe(true);
    expect(isValidWkt('GEOMETRYCOLLECTION(POINT(1 2))')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(isValidWkt('point(1 2)')).toBe(true);
    expect(isValidWkt('POINT(1 2)')).toBe(true);
    expect(isValidWkt('Point(1 2)')).toBe(true);
  });

  it('should return false for invalid formats', () => {
    expect(isValidWkt('INVALID(1 2)')).toBe(false);
    expect(isValidWkt('POINT 1 2')).toBe(false);
    expect(isValidWkt('(1 2)')).toBe(false);
  });
});

describe('toggleGeometryMode', () => {
  it('should convert WKT to SQL function when switching to raw SQL mode', () => {
    expect(toggleGeometryMode('POINT(1 2)', true)).toBe("ST_GeomFromText('POINT(1 2)')");
  });

  it('should return as-is if already SQL function when switching to raw SQL mode', () => {
    const sql = "ST_GeomFromText('POINT(1 2)')";
    expect(toggleGeometryMode(sql, true)).toBe(sql);
  });

  it('should extract WKT from SQL function when switching to simple mode', () => {
    expect(toggleGeometryMode("ST_GeomFromText('POINT(1 2)')", false)).toBe('POINT(1 2)');
    expect(toggleGeometryMode("ST_GeomFromText('POINT(1 2)', 4326)", false)).toBe('POINT(1 2)');
  });

  it('should return as-is if cannot extract when switching to simple mode', () => {
    expect(toggleGeometryMode('POINT(1 2)', false)).toBe('POINT(1 2)');
    expect(toggleGeometryMode('', false)).toBe('');
  });

  it('should handle empty string', () => {
    expect(toggleGeometryMode('', true)).toBe('');
    expect(toggleGeometryMode('', false)).toBe('');
  });

  it('should handle whitespace', () => {
    expect(toggleGeometryMode('  POINT(1 2)  ', true)).toBe("ST_GeomFromText('POINT(1 2)')");
    expect(toggleGeometryMode("  ST_GeomFromText('POINT(1 2)')  ", false)).toBe('POINT(1 2)');
  });
});
