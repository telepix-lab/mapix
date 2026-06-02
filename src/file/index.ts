import { kml } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
} from 'geojson';
import JSZip from 'jszip';
import shp from 'shpjs';
import type {
  FileParseErrorCode,
  FileParseResult,
  GeoJsonCorrection,
  SupportedFileType,
} from '../types';

// Extension to file-type mapping. SUPPORTED_FILE_ACCEPT is derived from this
// record too, so supporting a new extension only requires editing here.
const FILE_TYPE_BY_EXTENSION: Record<string, SupportedFileType> = {
  geojson: 'geojson',
  json: 'geojson',
  kml: 'kml',
  shp: 'shp',
  zip: 'shp',
};

/**
 * A string usable as-is for the accept attribute of `<input type="file">`.
 * e.g. `.geojson,.json,.kml,.shp,.zip`
 */
export const SUPPORTED_FILE_ACCEPT = Object.keys(FILE_TYPE_BY_EXTENSION)
  .map((ext) => `.${ext}`)
  .join(',');

export const getSupportedFileType = (
  filename: string
): SupportedFileType | null => {
  const extension = filename.toLowerCase().split('.').pop();
  if (!extension) return null;

  return FILE_TYPE_BY_EXTENSION[extension] ?? null;
};

/**
 * Main file-parsing entry point.
 *
 * Only performs the library's core parsing, structural validation, and
 * automatic corrections. Upload policy checks such as file size or vertex
 * count are the consumer's responsibility, and policy messages (e.g.
 * fileTooLarge / vertexLimitExceeded) are handled by the consumer too.
 */
export const parseFile = async (file: File): Promise<FileParseResult> => {
  try {
    const fileType = getSupportedFileType(file.name);

    if (!fileType) {
      return {
        success: false,
        errorCode: 'unsupportedFormat',
        error: 'Unsupported file format. Supported: GeoJSON, KML, SHP',
      };
    }

    let result: FileParseResult;

    switch (fileType) {
      case 'geojson':
        result = await parseGeoJSON(file);
        break;
      case 'kml':
        result = await parseKML(file);
        break;
      case 'shp':
        result = await parseSHP(file);
        break;
      default:
        return {
          success: false,
          errorCode: 'parseFailed',
          error: 'Unknown file format.',
        };
    }

    if (!result.success || !result.data) {
      return result;
    }

    // 1. Auto-correct type/coordinates mismatches (Polygon vs MultiPolygon).
    // polygonToMultiPolygon is the most specific correction, so it takes
    // precedence over the wrapping correction reported by parseGeoJSON.
    const corrected = correctFeatureCollection(result.data);
    result.data = corrected.collection;
    const incoming = corrected.correction;
    if (
      incoming &&
      (incoming === 'polygonToMultiPolygon' || !result.correction)
    ) {
      result.correction = incoming;
    }

    // 2. Unsupported geometry types (e.g. GeometryCollection); cannot be corrected
    if (hasUnsupportedGeometry(result.data)) {
      return {
        success: false,
        errorCode: 'geometryError',
        error: 'Contains an unsupported geometry type.',
      };
    }

    // 3. Keep only Polygon / MultiPolygon
    result.data = filterPolygons(result.data);

    if (result.data.features.length === 0) {
      return {
        success: false,
        errorCode: 'noPolygon',
        error: 'No Polygon features found. Only Polygon types are supported.',
      };
    }

    // Vertex-count validation is consumer policy, so the library leaves it out.
    // The caller compares via `countVertices(result.data)` and decides.
    return result;
  } catch (error) {
    return {
      success: false,
      errorCode: 'parseFailed',
      error: `Error while parsing the file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/**
 * Parses a GeoJSON file.
 * A single Geometry / Feature input is wrapped into a FeatureCollection and the
 * correction is reported. Features with `geometry: null` are filtered out up
 * front (same policy as the KML parser).
 */
const parseGeoJSON = async (file: File): Promise<FileParseResult> => {
  try {
    const text = await file.text();
    const geojson = JSON.parse(text) as unknown;

    if (!geojson || typeof geojson !== 'object') {
      return failParse('Invalid GeoJSON file.');
    }

    const obj = geojson as { type?: string; coordinates?: unknown };

    // Both FeatureCollection and Feature are user input, so by spec geometry is
    // nullable. `@types/geojson`'s default Feature is non-null, so we cast to
    // the nullable form explicitly to make the up-front null filter meaningful
    // (same policy as the KML parser).
    if (obj.type === 'FeatureCollection') {
      const fc = geojson as FeatureCollection<Geometry | null>;
      return {
        success: true,
        data: {
          type: 'FeatureCollection',
          features: fc.features.filter(
            (feature): feature is Feature => feature.geometry !== null
          ),
        },
      };
    }

    if (obj.type === 'Feature') {
      const feature = geojson as Feature<Geometry | null>;
      if (!feature.geometry) {
        return failParse('Feature has no geometry.');
      }
      return {
        success: true,
        data: {
          type: 'FeatureCollection',
          features: [feature as Feature],
        },
        correction: 'wrappedAsFeatureCollection',
      };
    }

    // A bare Geometry object: wrapped in two steps (Feature, then
    // FeatureCollection). Reports the first-step correction 'wrappedAsFeature'
    // (the message shown is generic).
    if (obj.type && obj.coordinates) {
      return {
        success: true,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: geojson as Feature['geometry'],
              properties: {},
            },
          ],
        },
        correction: 'wrappedAsFeature',
      };
    }

    return failParse('Unsupported GeoJSON structure.');
  } catch (error) {
    return failParse(
      `GeoJSON parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const parseKML = async (file: File): Promise<FileParseResult> => {
  try {
    const text = await file.text();
    const parser = new DOMParser();
    const kmlDoc = parser.parseFromString(text, 'text/xml');

    const geojson = kml(kmlDoc);

    if (geojson.features.length === 0) {
      return failParse('No valid features found in the KML file.');
    }

    const validFeatures = geojson.features.filter(
      (feature): feature is Feature => feature.geometry !== null
    );

    if (validFeatures.length === 0) {
      return failParse(
        'No features with valid geometry found in the KML file.'
      );
    }

    return {
      success: true,
      data: { type: 'FeatureCollection', features: validFeatures },
    };
  } catch (error) {
    return failParse(
      `KML parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const parseSHP = async (file: File): Promise<FileParseResult> => {
  try {
    const arrayBuffer = await file.arrayBuffer();

    let shpResult: unknown;

    if (file.name.toLowerCase().endsWith('.zip')) {
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(arrayBuffer);

      const shpFile = Object.keys(zipContent.files).find((name) =>
        name.toLowerCase().endsWith('.shp')
      );

      if (!shpFile) {
        return failParse('No SHP file found in the ZIP.');
      }

      const shpBuffer = await zipContent.files[shpFile].async('arraybuffer');
      shpResult = await shp(shpBuffer);
    } else {
      shpResult = await shp(arrayBuffer);
    }

    let geojson: FeatureCollection;

    if (Array.isArray(shpResult)) {
      if (shpResult.length === 0) {
        return failParse('No valid features found in the SHP file.');
      }
      geojson = shpResult[0] as FeatureCollection;
    } else {
      geojson = shpResult as FeatureCollection;
    }

    if (geojson.features.length === 0) {
      return failParse('No valid features found in the SHP file.');
    }

    return { success: true, data: geojson };
  } catch (error) {
    return failParse(
      `SHP parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const failParse = (message: string): FileParseResult => ({
  success: false,
  errorCode: 'parseFailed',
  error: message,
});

/**
 * Detects coordinates declared as `type: "Polygon"` but nested four deep (a
 * MultiPolygon structure). Handles cases where external tools such as the OSM
 * Overpass API mis-serialize multi-part administrative boundaries.
 */
const isMultiPolygonShape = (coords: unknown): boolean => {
  if (!Array.isArray(coords)) return false;
  const polygons = coords as unknown[];
  const firstPolygon = polygons[0];
  if (!Array.isArray(firstPolygon)) return false;
  const rings = firstPolygon as unknown[];
  const firstRing = rings[0];
  if (!Array.isArray(firstRing)) return false;
  const positions = firstRing as unknown[];
  const firstPosition = positions[0];
  // A Position is a [lng, lat] array (length >= 2, first element a number).
  // If nested four deep, firstPosition itself has the shape of a Position.
  if (!Array.isArray(firstPosition)) return false;
  const position = firstPosition as unknown[];
  return position.length >= 2 && typeof position[0] === 'number';
};

/**
 * Auto-corrects the geometry type. Only the type field is changed; coordinates
 * are left untouched.
 */
const correctFeatureGeometry = (
  feature: Feature
): { feature: Feature; correction?: GeoJsonCorrection } => {
  const geometry = feature.geometry;
  if (
    geometry.type === 'Polygon' &&
    isMultiPolygonShape(geometry.coordinates)
  ) {
    const corrected: Feature<MultiPolygon> = {
      ...feature,
      geometry: {
        type: 'MultiPolygon',
        coordinates:
          geometry.coordinates as unknown as MultiPolygon['coordinates'],
      },
    };
    return { feature: corrected, correction: 'polygonToMultiPolygon' };
  }
  return { feature };
};

const correctFeatureCollection = (
  collection: FeatureCollection
): { collection: FeatureCollection; correction?: GeoJsonCorrection } => {
  let firstCorrection: GeoJsonCorrection | undefined;
  const features = collection.features.map((feature) => {
    const result = correctFeatureGeometry(feature);
    if (result.correction && !firstCorrection) {
      firstCorrection = result.correction;
    }
    return result.feature;
  });
  return {
    collection: { type: 'FeatureCollection', features },
    correction: firstCorrection,
  };
};

const hasUnsupportedGeometry = (collection: FeatureCollection): boolean => {
  return collection.features.some(
    (feature) => feature.geometry.type === 'GeometryCollection'
  );
};

const filterPolygons = (
  featureCollection: FeatureCollection
): FeatureCollection => {
  const polygonFeatures = featureCollection.features.filter(
    (feature: Feature) => {
      const geometry = feature.geometry;
      return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
    }
  );

  return { type: 'FeatureCollection', features: polygonFeatures };
};

/**
 * Sums the coordinates across every polygon ring in a FeatureCollection.
 *
 * Counts outer rings and holes alike, giving the caller a conservative count
 * for applying a limit policy (for external data with few holes this barely
 * differs from counting outer rings only).
 */
export const countVertices = (collection: FeatureCollection): number => {
  let count = 0;
  for (const feature of collection.features) {
    const geometry = feature.geometry;

    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        count += ring.length;
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          count += ring.length;
        }
      }
    }
  }
  return count;
};

export type { FileParseErrorCode };
