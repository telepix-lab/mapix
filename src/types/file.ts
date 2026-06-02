import type { FeatureCollection } from 'geojson';

export type SupportedFileType = 'geojson' | 'kml' | 'shp';

/**
 * Codes for why file parsing failed.
 *
 * Limited to the library's core parsing and structural validation. Upload
 * policy checks such as file size or vertex limits are decided and handled by
 * the consumer, so they are not included here.
 */
export type FileParseErrorCode =
  | 'unsupportedFormat'
  | 'parseFailed'
  | 'noPolygon'
  | 'invalidCoordinates'
  | 'geometryError';

/**
 * Kinds of automatic GeoJSON correction.
 * - polygonToMultiPolygon: type is Polygon but coordinates have a MultiPolygon
 *   structure (nested four deep); only the type is fixed
 * - wrappedAsFeature: a bare Geometry object wrapped into a Feature
 * - wrappedAsFeatureCollection: a single Feature or Geometry wrapped into a
 *   FeatureCollection
 */
export type GeoJsonCorrection =
  | 'polygonToMultiPolygon'
  | 'wrappedAsFeature'
  | 'wrappedAsFeatureCollection';

export interface FileParseResult {
  success: boolean;
  data?: FeatureCollection;
  error?: string;
  /** Code for mapping to an i18n key on failure */
  errorCode?: FileParseErrorCode;
  /** Set when an automatic correction was applied (e.g. to show a notice toast) */
  correction?: GeoJsonCorrection;
}
