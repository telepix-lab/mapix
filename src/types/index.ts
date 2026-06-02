/**
 * mapix public API type definitions.
 */

// Tile types
export type { TileJsonResponse } from './tile';

// Compare types
export type {
  CompareEventType,
  CompareOptions,
  CompareOrientation,
  SlideEndEvent,
} from './compare';

// Draw types
export type {
  DoubleClickZoomControl,
  DrawConfig,
  DrawCustomMode,
  DrawCustomModeThis,
  DrawFeature,
  DrawPolygonFeature,
  PolygonIntersection,
  PolygonOptions,
  PolygonState,
  RectangleState,
} from './draw';

// File parsing types
export type {
  FileParseErrorCode,
  FileParseResult,
  GeoJsonCorrection,
  SupportedFileType,
} from './file';

// GeoJSON type re-exports so consumers can narrow file-parsing result types
// without depending on @types/geojson directly
export type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson';
