import type { MultiPolygon, Polygon, Position } from 'geojson';

/** Tolerance for floating-point comparison. */
const TOLERANCE = 0.0000001;

/**
 * Reports whether a polygon ring is closed and its actual vertex count.
 * @param coordinates polygon coordinate array
 * @returns { isClosed: boolean, vertexCount: number }
 */
export function getPolygonInfo(coordinates: Position[]): {
  isClosed: boolean;
  vertexCount: number;
} {
  const isClosed =
    coordinates.length > 1 &&
    coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
    coordinates[0][1] === coordinates[coordinates.length - 1][1];

  const vertexCount = isClosed ? coordinates.length - 1 : coordinates.length;

  return { isClosed, vertexCount };
}

/**
 * Reports whether a polygon is a true axis-aligned rectangle, i.e. every edge
 * is horizontal or vertical (not merely a 4-vertex polygon).
 *
 * @param coordinates the polygon's first ring
 * @returns whether it is a rectangle
 */
export function isRectangle(coordinates: Position[]): boolean {
  // Closed polygon: 5 coords, open polygon: 4 coords
  const vertexCount =
    coordinates.length === 5 || coordinates.length === 4 ? 4 : 0;

  if (vertexCount !== 4) return false;

  const [p0, p1, p2, p3] = coordinates;

  // Each edge (0->1, 1->2, 2->3, 3->0) must be horizontal or vertical
  const isHorizontal = (a: Position, b: Position) =>
    Math.abs(a[1] - b[1]) < TOLERANCE;
  const isVertical = (a: Position, b: Position) =>
    Math.abs(a[0] - b[0]) < TOLERANCE;

  // First edge horizontal => H-V-H-V pattern; first edge vertical => V-H-V-H
  const edge01Horizontal = isHorizontal(p0, p1);
  const edge01Vertical = isVertical(p0, p1);

  if (edge01Horizontal) {
    return isVertical(p1, p2) && isHorizontal(p2, p3) && isVertical(p3, p0);
  } else if (edge01Vertical) {
    return isHorizontal(p1, p2) && isVertical(p2, p3) && isHorizontal(p3, p0);
  }

  // First edge is neither horizontal nor vertical, so not a rectangle (e.g. trapezoid)
  return false;
}

/**
 * Reports whether a GeoJSON Polygon / MultiPolygon geometry is a true
 * axis-aligned rectangle.
 *
 * - a MultiPolygon is not a single rectangle, so it is always `false`
 * - a Polygon with holes (inner rings) is not a rectangle either
 * - otherwise the outer ring is checked with {@link isRectangle}
 *
 * @param geometry Polygon or MultiPolygon geometry
 * @returns whether it is a rectangle
 */
export function isRectangleGeometry(geometry: Polygon | MultiPolygon): boolean {
  if (geometry.type !== 'Polygon') return false;
  // A single outer ring only — a donut with holes is not a rectangle
  if (geometry.coordinates.length !== 1) return false;

  return isRectangle(geometry.coordinates[0]);
}

function distance(p1: Position, p2: Position): number {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Finds the vertex farthest from the dragged vertex (its diagonal opposite).
 * @param coordinates polygon coordinates
 * @param vertexIndex index of the dragged vertex
 * @returns index of the farthest vertex
 */
export function getOppositeVertexIndex(
  coordinates: Position[],
  vertexIndex: number
): number {
  const vertex = coordinates[vertexIndex];
  let maxDist = -1;
  let oppositeIndex = 0;

  const { vertexCount } = getPolygonInfo(coordinates);

  for (let i = 0; i < vertexCount; i++) {
    if (i === vertexIndex) continue;
    const dist = distance(vertex, coordinates[i]);
    if (dist > maxDist) {
      maxDist = dist;
      oppositeIndex = i;
    }
  }

  return oppositeIndex;
}

/**
 * Scales a polygon independently along X and Y (aspect ratio may change).
 * The diagonally opposite vertex is held fixed as the anchor while the X and
 * Y axes are scaled separately.
 *
 * @param coordinates current polygon coordinates
 * @param vertexIndex index of the dragged vertex
 * @param newLng new longitude
 * @param newLat new latitude
 * @returns the scaled coordinate array
 */
export function scalePolygonFromVertex(
  coordinates: Position[],
  vertexIndex: number,
  newLng: number,
  newLat: number
): Position[] {
  const { isClosed, vertexCount } = getPolygonInfo(coordinates);

  // Anchor: the diagonally opposite vertex, held fixed
  const anchorIndex = getOppositeVertexIndex(coordinates, vertexIndex);
  const anchor = coordinates[anchorIndex];

  const originalVertex = coordinates[vertexIndex];

  // Per-axis deltas from the anchor
  const originalDeltaX = originalVertex[0] - anchor[0];
  const originalDeltaY = originalVertex[1] - anchor[1];

  const newDeltaX = newLng - anchor[0];
  const newDeltaY = newLat - anchor[1];

  // Per-axis scale factors
  const scaleX =
    Math.abs(originalDeltaX) > TOLERANCE ? newDeltaX / originalDeltaX : 1;
  const scaleY =
    Math.abs(originalDeltaY) > TOLERANCE ? newDeltaY / originalDeltaY : 1;

  // Scale every vertex about the anchor, X and Y independently
  const newCoords: Position[] = [];

  for (let i = 0; i < vertexCount; i++) {
    const coord = coordinates[i];
    const relX = coord[0] - anchor[0];
    const relY = coord[1] - anchor[1];
    const scaledX = anchor[0] + relX * scaleX;
    const scaledY = anchor[1] + relY * scaleY;
    newCoords.push([scaledX, scaledY]);
  }

  // Re-close the ring if the input was closed
  if (isClosed) {
    newCoords.push([newCoords[0][0], newCoords[0][1]]);
  }

  return newCoords;
}

/**
 * Moves a vertex while keeping the rectangle shape (used while Shift is held).
 *
 * DrawRectangle coordinate order (0 bottom-left, 1 bottom-right, 2 top-right,
 * 3 top-left):
 * - drag 0 (bottom-left)  => update X of 3 (top-left),    Y of 1 (bottom-right)
 * - drag 1 (bottom-right) => update Y of 0 (bottom-left),  X of 2 (top-right)
 * - drag 2 (top-right)    => update X of 1 (bottom-right), Y of 3 (top-left)
 * - drag 3 (top-left)     => update Y of 2 (top-right),    X of 0 (bottom-left)
 *
 * @param coordinates current polygon coordinates (5, closed)
 * @param vertexIndex index of the dragged vertex (0-3)
 * @param newLng new longitude
 * @param newLat new latitude
 * @returns the new coordinate array
 */
export function constrainToRectangle(
  coordinates: Position[],
  vertexIndex: number,
  newLng: number,
  newLat: number
): Position[] {
  const c0 = [...coordinates[0]] as Position; // bottom-left
  const c1 = [...coordinates[1]] as Position; // bottom-right
  const c2 = [...coordinates[2]] as Position; // top-right
  const c3 = [...coordinates[3]] as Position; // top-left

  switch (vertexIndex) {
    case 0: // drag bottom-left
      c0[0] = newLng;
      c0[1] = newLat;
      c3[0] = newLng; // top-left shares the left edge (X)
      c1[1] = newLat; // bottom-right shares the bottom edge (Y)
      break;

    case 1: // drag bottom-right
      c1[0] = newLng;
      c1[1] = newLat;
      c0[1] = newLat; // bottom-left shares the bottom edge (Y)
      c2[0] = newLng; // top-right shares the right edge (X)
      break;

    case 2: // drag top-right
      c2[0] = newLng;
      c2[1] = newLat;
      c1[0] = newLng; // bottom-right shares the right edge (X)
      c3[1] = newLat; // top-left shares the top edge (Y)
      break;

    case 3: // drag top-left
      c3[0] = newLng;
      c3[1] = newLat;
      c2[1] = newLat; // top-right shares the top edge (Y)
      c0[0] = newLng; // bottom-left shares the left edge (X)
      break;

    default:
      // Invalid index: return the input unchanged
      return coordinates;
  }

  // Return a closed ring (first and last coordinates identical)
  return [c0, c1, c2, c3, [...c0] as Position];
}
