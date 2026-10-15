declare module 'wkx' {
  export class Geometry {
    static parse(value: Buffer | string): Geometry;
    toWkt(): string;
  }

  export class Point extends Geometry {
    x: number;
    y: number;
    z?: number;
    m?: number;
  }

  export class LineString extends Geometry {
    points: Point[];
  }

  export class Polygon extends Geometry {
    exteriorRing: Point[];
    interiorRings: Point[][];
  }

  export class MultiPoint extends Geometry {
    points: Point[];
  }

  export class MultiLineString extends Geometry {
    lineStrings: LineString[];
  }

  export class MultiPolygon extends Geometry {
    polygons: Polygon[];
  }

  export class GeometryCollection extends Geometry {
    geometries: Geometry[];
  }
}
