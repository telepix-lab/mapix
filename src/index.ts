declare const __MAPIX_VERSION__: string;
export const VERSION = __MAPIX_VERSION__;

export type {
  CompareBounds,
  CompareEventType,
  CompareOptions,
  CompareOrientation,
  DoubleClickZoomControl,
  DrawConfig,
  DrawCustomMode,
  DrawCustomModeThis,
  DrawFeature,
  DrawPolygonFeature,
  Feature,
  FeatureCollection,
  FileParseErrorCode,
  FileParseResult,
  GeoJsonCorrection,
  MultiPolygon,
  PointFeature,
  Polygon,
  PolygonIntersection,
  PolygonOptions,
  PolygonState,
  Position,
  RectangleState,
  SlideEndEvent,
  SupportedFileType,
  TileJsonResponse,
} from './types';

export { Compare } from './compare';

export * from './file';

// Draw Modes
export { default as DrawPolygon } from './draw/modes/draw-polygon';
export { default as DrawRectangle } from './draw/modes/draw-rectangle';
export { default as DirectSelectWithIntersection } from './draw/modes/direct-select-with-intersection';

// Draw Utils
export {
  constrainToRectangle,
  getOppositeVertexIndex,
  getPolygonInfo,
  isRectangle,
  isRectangleGeometry,
  scalePolygonFromVertex,
} from './draw/utils/rectangle-utils';

// Area formatting. Auto-switches between m² and km² around a configurable threshold
export { formatArea } from './draw/utils/format-area';
export type {
  FormatAreaOptions,
  FormattedArea,
} from './draw/utils/format-area';

// Draw styles. Shared AOI style constants (used by both upload and drawing)
export {
  AOI_FILL_COLOR,
  AOI_FILL_OPACITY,
  AOI_LINE_COLOR,
  AOI_LINE_WIDTH,
} from './draw/styles';

// Map helpers. Source/layer manipulation for a mapbox-gl Map
export { removeLayerIfExists, removeSourceIfExists } from './map-utils';
