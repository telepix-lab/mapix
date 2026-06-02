/**
 * DrawPolygon self-intersection detection and red-warning visualization.
 *
 * Separation of concerns:
 * - draw-polygon.ts focuses on mode lifecycle, vertex management, and
 *   click/key branching.
 * - this file focuses on the self-intersection math and managing the warning
 *   source/layer on the map.
 *
 * Only the high-level API is exported; the detection algorithm and the
 * source/layer ids stay internal.
 */

import type { Feature, Position } from 'geojson';
import type { Map } from 'mapbox-gl';
import type { PolygonIntersection, PolygonState } from '../../types';
import { removeLayerIfExists, removeSourceIfExists } from '../../map-utils';

// Source/layer ids for the self-intersection warning, used only within this
// module. They are registered directly on the map so it works without the
// consumer injecting any styles. The two involved edges (LineString) and the
// intersection point (Point) share one source, so the circle and line layers
// map automatically by geometry type.
const WARNING_SOURCE_ID = 'mapix-draw-polygon-warning';
const WARNING_LINE_OUTER_LAYER_ID = 'mapix-draw-polygon-warning-line-outer';
const WARNING_LINE_LAYER_ID = 'mapix-draw-polygon-warning-line';
const WARNING_POINT_LAYER_ID = 'mapix-draw-polygon-warning-point';
const WARNING_COLOR = '#ef4444';
// Some consumers draw the polygon line as stroke 2 + outer 4, so to cover it
// completely without leaving a fringe the outer width has to be one step
// thicker than the base stack. outer (dark border, aids visibility) 7 /
// inner (red) 5 looks natural across consumers.
const WARNING_LINE_OUTER_WIDTH = 7;
const WARNING_LINE_INNER_WIDTH = 5;

// Returns the intersection point of two segments [a,b], [c,d] in 2D lng/lat.
// Sharing only an endpoint does not count as an intersection (strict
// inequalities). A planar approximation is good enough at AOI drawing scales
// (a few to tens of km), since this is only for self-intersection UX.
const segmentsIntersect = (
  a: Position,
  b: Position,
  c: Position,
  d: Position
): Position | null => {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const tx = c[0] - a[0];
  const ty = c[1] - a[1];
  const t = (tx * sy - ty * sx) / denom;
  const u = (tx * ry - ty * rx) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return [a[0] + t * rx, a[1] + t * ry];
};

// Checks whether the new edge (ring[lookaheadIdx-1] -> ring[lookaheadIdx])
// crosses any existing non-adjacent edge (ring[i] -> ring[i+1], i in
// [0, lookaheadIdx-3]). The adjacent edge that shares an endpoint
// (i = lookaheadIdx-2) is excluded naturally by the strict inequalities, but
// is also skipped explicitly from the loop range for performance and clarity.
const findNewSegmentIntersection = (
  ring: Position[],
  lookaheadIdx: number
): PolygonIntersection | null => {
  if (lookaheadIdx < 2) return null;
  const a = ring[lookaheadIdx - 1];
  const b = ring[lookaheadIdx];
  for (let i = 0; i < lookaheadIdx - 2; i++) {
    const ip = segmentsIntersect(a, b, ring[i], ring[i + 1]);
    if (ip) {
      return {
        point: ip,
        newSegment: [a, b],
        existingSegment: [ring[i], ring[i + 1]],
        kind: 'blocking',
      };
    }
  }
  return null;
};

// Checks whether the auto-closing edge (ring[lookaheadIdx] -> ring[0]) crosses
// an interior edge. mapbox-gl-draw auto-renders this closing edge as part of
// the polygon outline, so if it crosses a prior edge the user is looking at a
// visually invalid polygon, which warrants a red warning while drawing.
// Adjacent edges are excluded from the loop (i=0 shares v_first,
// i=lookaheadIdx-1 shares lookahead). The new edge (lookaheadIdx-1) also shares
// lookahead and is excluded, leaving i in [1, lookaheadIdx-2].
const findAutoClosingIntersection = (
  ring: Position[],
  lookaheadIdx: number
): PolygonIntersection | null => {
  if (lookaheadIdx < 3) return null;
  const lookahead = ring[lookaheadIdx];
  const first = ring[0];
  for (let i = 1; i < lookaheadIdx - 1; i++) {
    const ip = segmentsIntersect(lookahead, first, ring[i], ring[i + 1]);
    if (ip) {
      return {
        point: ip,
        newSegment: [lookahead, first],
        existingSegment: [ring[i], ring[i + 1]],
        // visual-only: an auto-closing intersection is a transient state that
        // adding more vertices can resolve, so it shows the red warning but
        // still allows clicks so the user can keep extending the polygon.
        kind: 'visual-only',
      };
    }
  }
  return null;
};

// Checks whether the closing edge (ring[vertexCount-1] -> ring[0]) crosses an
// interior edge. Used on the close path when lookahead is not on v0 (Enter /
// dblclick / clickAnywhere-isAtLastVertex). i=0 (adjacent to v0) and
// i=vertexCount-2 (adjacent to last) share an endpoint and are excluded.
const findClosingIntersection = (
  ring: Position[],
  vertexCount: number
): PolygonIntersection | null => {
  if (vertexCount < 4) return null;
  const last = ring[vertexCount - 1];
  const first = ring[0];
  for (let i = 1; i < vertexCount - 2; i++) {
    const ip = segmentsIntersect(last, first, ring[i], ring[i + 1]);
    if (ip) {
      return {
        point: ip,
        newSegment: [last, first],
        existingSegment: [ring[i], ring[i + 1]],
        // blocking: a closing-edge intersection at close time would lock the
        // final polygon into a self-intersection, so it is always blocked.
        kind: 'blocking',
      };
    }
  }
  return null;
};

/**
 * Exhaustively checks every non-adjacent edge pair of a polygon ring for
 * self-intersection (O(N²)).
 *
 * Used to validate vertex drags in direct_select: regardless of which vertex
 * moved or how, it detects any two non-adjacent edges crossing in the
 * resulting polygon. Negligible cost under an N <= 100 policy.
 *
 * `ring` is auto-closed by mapbox-gl-draw (`ring[N] === ring[0]`). Adjacent
 * edges that share an endpoint are excluded by the strict inequalities, and
 * are also skipped explicitly in the loop.
 */
export const findFirstSelfIntersection = (
  ring: Position[]
): PolygonIntersection | null => {
  const n = ring.length - 1;
  if (n < 4) return null;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n; j++) {
      // Wrap-around adjacency: (i=0, j=n-1) shares ring[0]
      if (i === 0 && j === n - 1) continue;
      const ip = segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1]);
      if (ip) {
        return {
          point: ip,
          newSegment: [ring[i], ring[i + 1]],
          existingSegment: [ring[j], ring[j + 1]],
          kind: 'blocking',
        };
      }
    }
  }
  return null;
};

const setWarning = (map: Map, info: PolygonIntersection | null): void => {
  const src = map.getSource(WARNING_SOURCE_ID);
  // Only a GeoJSONSource has setData; guards against the abnormal case of
  // another source type occupying the same id.
  if (src?.type !== 'geojson') return;
  const features: Feature[] = info
    ? [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: info.newSegment },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: info.existingSegment },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: info.point },
        },
      ]
    : [];
  src.setData({ type: 'FeatureCollection', features });
};

// Structural type for the self-intersection fields shared by both the
// DrawPolygon and direct_select wrapper mode states.
interface IntersectionStateLike {
  intersection?: PolygonIntersection;
  pendingWarningRaf?: number;
}

// Flushes the latest state.intersection to the source on the next RAF.
// mapbox-gl-draw flushes its polygon source on a RAF, so syncing ours to the
// same frame keeps them painted together. Calling setData immediately would
// draw the red one frame ahead of the polygon's white line, leaving a fringe.
export const scheduleWarningRender = (
  state: IntersectionStateLike,
  map: Map
): void => {
  if (state.pendingWarningRaf !== undefined) return;
  state.pendingWarningRaf = requestAnimationFrame(() => {
    state.pendingWarningRaf = undefined;
    setWarning(map, state.intersection ?? null);
  });
};

/**
 * Registers the self-intersection warning source/layers on the map. Called
 * from the mode's onSetup. Stacked outer (black), inner (red), then marker so
 * the polygon's stroke and outer stroke are fully covered.
 */
export const ensureWarningLayer = (map: Map): void => {
  if (!map.getSource(WARNING_SOURCE_ID)) {
    map.addSource(WARNING_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(WARNING_LINE_OUTER_LAYER_ID)) {
    map.addLayer({
      id: WARNING_LINE_OUTER_LAYER_ID,
      type: 'line',
      source: WARNING_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#000000',
        'line-opacity': 0.4,
        'line-width': WARNING_LINE_OUTER_WIDTH,
      },
    });
  }
  if (!map.getLayer(WARNING_LINE_LAYER_ID)) {
    map.addLayer({
      id: WARNING_LINE_LAYER_ID,
      type: 'line',
      source: WARNING_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': WARNING_COLOR,
        'line-width': WARNING_LINE_INNER_WIDTH,
      },
    });
  }
  if (!map.getLayer(WARNING_POINT_LAYER_ID)) {
    map.addLayer({
      id: WARNING_POINT_LAYER_ID,
      type: 'circle',
      source: WARNING_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': WARNING_COLOR,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
  }
};

/**
 * Cleans up the self-intersection warning source/layers. Called from the
 * mode's onStop.
 */
export const removeWarningLayer = (map: Map): void => {
  removeLayerIfExists(map, WARNING_POINT_LAYER_ID);
  removeLayerIfExists(map, WARNING_LINE_LAYER_ID);
  removeLayerIfExists(map, WARNING_LINE_OUTER_LAYER_ID);
  removeSourceIfExists(map, WARNING_SOURCE_ID);
};

/**
 * Cancels a pending RAF if one is queued. Called in onStop just before the
 * source is removed.
 */
export const cancelWarningRender = (state: IntersectionStateLike): void => {
  if (state.pendingWarningRaf === undefined) return;
  cancelAnimationFrame(state.pendingWarningRaf);
  state.pendingWarningRaf = undefined;
};

/**
 * Updates the self-intersection state and syncs the red-warning visualization.
 * Shared path for mouseMove / undo / redo / Backspace.
 *
 * Avoids scheduling a RAF when nothing changed; scheduling on every mouseMove
 * (~60fps) would back up the RAF queue.
 * 1) skip if both are empty (the most common case)
 * 2) skip if it is the same intersection point (mouse held still)
 */
export const updateIntersection = (state: PolygonState, map: Map): void => {
  const ring = state.polygon.getCoordinates()[0];
  // Check both segments:
  // 1) lookahead segment [v_last, lookahead]: the new edge being drawn
  // 2) auto-closing segment [lookahead, v_first]: the polygon outline's
  //    automatically closed edge
  // If either crosses, the polygon the user sees is self-intersecting, so show
  // the red warning and block the click.
  const info =
    findNewSegmentIntersection(ring, state.currentVertexPosition) ??
    findAutoClosingIntersection(ring, state.currentVertexPosition);
  if (!info && !state.intersection) return;
  if (
    info &&
    info.point[0] === state.intersection?.point[0] &&
    info.point[1] === state.intersection.point[1]
  ) {
    return;
  }
  state.intersection = info ?? undefined;
  scheduleWarningRender(state, map);
};

/**
 * Resets the self-intersection state and clears the warning markers. Used on
 * the first-stage ESC reset path.
 */
export const clearIntersection = (state: PolygonState, map: Map): void => {
  state.intersection = undefined;
  scheduleWarningRender(state, map);
};

/**
 * Checks the closing edge (ring[vertexCount-1] -> ring[0]) for an intersection
 * and, if found, updates state.intersection and schedules the red-warning
 * render.
 *
 * Returns true if the intersection means close should be blocked. Callers
 * (clickAnywhere isAtLastVertex / handleDoubleClick / Enter) use it as a guard
 * right before the close branch.
 */
export const markClosingIntersection = (
  state: PolygonState,
  map: Map,
  ring: Position[],
  vertexCount: number
): boolean => {
  const closingInfo = findClosingIntersection(ring, vertexCount);
  if (!closingInfo) return false;
  state.intersection = closingInfo;
  scheduleWarningRender(state, map);
  return true;
};
