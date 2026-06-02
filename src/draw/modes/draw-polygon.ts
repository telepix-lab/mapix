import type MapboxDraw from '@mapbox/mapbox-gl-draw';
import type { Feature, GeoJSON, LineString, Point, Polygon } from 'geojson';
import type {
  DrawCustomMode,
  DrawCustomModeThis,
  DrawPolygonFeature,
  PolygonOptions,
  PolygonState,
} from '../../types';
import { doubleClickZoom } from '../controls/double-click-zoom';
import {
  cancelWarningRender,
  clearIntersection,
  ensureWarningLayer,
  markClosingIntersection,
  removeWarningLayer,
  updateIntersection,
} from './polygon-intersection';

// Handlers receive events to which mapbox-gl-draw has attached a featureTarget.
// `@types/mapbox__mapbox-gl-draw` declares featureTarget as required, but in
// practice it is absent when clicking outside a feature, so we make it optional.
type DrawPointerEvent = (
  | Omit<MapboxDraw.MapMouseEvent, 'featureTarget'>
  | Omit<MapboxDraw.MapTouchEvent, 'featureTarget'>
) & {
  featureTarget?: MapboxDraw.DrawFeature;
};

// A polygon needs at least 3 vertices by definition (the library's concern).
// Policy values like a vertex cap (e.g. 1000) are injected by the consumer via
// PolygonOptions.maxVertices.
const MIN_POLYGON_VERTICES_TO_COMPLETE = 3;

// Vertex marker GeoJSON (identical to mapbox-gl-draw's createVertex)
const createVertex = (
  parentId: string | number,
  coordinates: number[],
  path: string,
  selected: boolean
): Feature<Point> => ({
  type: 'Feature',
  properties: {
    meta: 'vertex',
    parent: parentId,
    coord_path: path,
    active: selected ? 'true' : 'false',
  },
  geometry: {
    type: 'Point',
    coordinates,
  },
});

const isEventAtCoordinates = (e: DrawPointerEvent, coords: number[]): boolean =>
  e.lngLat.lng === coords[0] && e.lngLat.lat === coords[1];

// Checks whether e.featureTarget is a vertex. If polygonId is given, only this
// polygon's vertices count, so that clicking a vertex of another polygon (e.g.
// a readonly AOI restored from localStorage) does not accidentally trigger a close.
const isVertex = (
  e: DrawPointerEvent,
  polygonId?: string | number
): boolean => {
  const props = e.featureTarget?.properties;
  if (props?.meta !== 'vertex') return false;
  if (polygonId === undefined) return true;
  return (props as { parent?: string | number }).parent === polygonId;
};

// Removes the last placed vertex. Shared by Backspace / Ctrl+Z.
// Uses setCoordinates instead of removeCoordinate to avoid mapbox-gl-draw
// auto-deleting the ring itself when ring.length < 3.
const removeLastVertex = (state: PolygonState): void => {
  if (state.currentVertexPosition <= 0) return;

  const coords = state.polygon.getCoordinates()[0];
  const lookahead = coords[state.currentVertexPosition];
  const removedCoord = coords[state.currentVertexPosition - 1];

  state.redoStack.push(removedCoord as [number, number]);
  state.currentVertexPosition--;
  const kept = coords.slice(0, state.currentVertexPosition);
  state.polygon.setCoordinates(kept.length > 0 ? [kept] : [[]]);

  // Re-add the lookahead vertex at the cursor so the polygon preview stays
  // connected to the mouse even without an onMouseMove
  if (state.currentVertexPosition > 0) {
    state.polygon.updateCoordinate(
      `0.${String(state.currentVertexPosition)}`,
      lookahead[0],
      lookahead[1]
    );
  }
};

// Redo for Ctrl+Shift+Z: restores the most recently removed vertex at the lookahead slot.
const redoLastVertex = (state: PolygonState): void => {
  if (state.redoStack.length === 0) return;
  const coord = state.redoStack.pop();
  if (!coord) return;
  const coords = state.polygon.getCoordinates()[0];
  const lookahead = coords[state.currentVertexPosition];

  state.polygon.updateCoordinate(
    `0.${String(state.currentVertexPosition)}`,
    coord[0],
    coord[1]
  );
  state.currentVertexPosition++;

  state.polygon.updateCoordinate(
    `0.${String(state.currentVertexPosition)}`,
    lookahead[0],
    lookahead[1]
  );
};

// Whether maxVertices has been reached. Used in the dblclick / close branches
// to decide whether to skip cvp--; to preserve N user clicks as N polygon
// vertices, cvp-- must not happen.
const hasReachedMaxVertices = (state: PolygonState): boolean =>
  state.maxVertices !== undefined &&
  state.currentVertexPosition >= state.maxVertices;

function clickAnywhere(
  this: DrawCustomModeThis,
  state: PolygonState,
  e: DrawPointerEvent
): void {
  const ring = state.polygon.getCoordinates()[0];
  const isAtLastVertex =
    state.currentVertexPosition > 0 &&
    isEventAtCoordinates(e, ring[state.currentVertexPosition - 1]);

  if (isAtLastVertex) {
    // Clicking again on the same spot as the last vertex: the second click of a
    // dblclick, or an explicit close attempt. Only allow closing when there are
    // more unique vertices than MIN. When cvp <= MIN the dblclick's first click
    // just added a vertex, so do not close; ignore it (handleDoubleClick finishes).
    if (state.currentVertexPosition <= MIN_POLYGON_VERTICES_TO_COMPLETE) return;

    // If the closing edge (last_placed -> v0) crosses an interior edge, block
    // the close and show the red warning. Validate the closing edge of the
    // user's intended polygon (cvp as-is), [v_last_placed, v_first]. Validating
    // the trimmed polygon (finalVertexCount) would miss the self-intersection
    // caused when the user's last placed vertex is dropped by the close-time
    // trim, e.g. placing 5 points in an hourglass and finishing with a dblclick
    // on the last point used to miss the [v_5, v_1] crossing.
    if (
      markClosingIntersection(
        state,
        this.map,
        ring,
        state.currentVertexPosition
      )
    ) {
      return;
    }

    // Remove the one duplicate vertex added last, then close.
    // But when the last click added no vertex because maxVertices blocked it
    // (reachedMax), there is no duplicate to remove, so skip cvp-- to avoid
    // losing the user's intended last vertex.
    const trimLookahead = !hasReachedMaxVertices(state);
    if (trimLookahead) {
      state.currentVertexPosition--;
      const trimmed = ring.slice(0, state.currentVertexPosition);
      state.polygon.setCoordinates(trimmed.length > 0 ? [trimmed] : [[]]);
    }
    this.changeMode('simple_select', {
      featureIds: [state.polygon.id],
    });
    return;
  }

  // Only block committing a vertex when the new (lookahead) edge crosses
  // (kind='blocking'). An auto-closing crossing (kind='visual-only') shows the
  // red warning but allows the click, so the user can add more vertices and
  // resolve the crossing by extending the polygon.
  if (state.intersection?.kind === 'blocking') return;

  // If the consumer injected maxVertices, block adding more once the cap is reached (silent)
  if (hasReachedMaxVertices(state)) return;

  this.updateUIClasses({ mouse: 'add' });
  state.polygon.updateCoordinate(
    `0.${String(state.currentVertexPosition)}`,
    e.lngLat.lng,
    e.lngLat.lat
  );
  state.currentVertexPosition++;
  state.redoStack = [];
  // Lookahead vertex that tracks the cursor
  state.polygon.updateCoordinate(
    `0.${String(state.currentVertexPosition)}`,
    e.lngLat.lng,
    e.lngLat.lat
  );
}

function clickOnVertex(this: DrawCustomModeThis, state: PolygonState): void {
  // Click on this polygon's own vertex: triggers a close.
  // But if cvp is below MIN the polygon is not valid yet, so ignore the close
  // (so the mode does not exit unintentionally when, say, the user dblclicks on v0).
  if (state.currentVertexPosition < MIN_POLYGON_VERTICES_TO_COMPLETE) return;
  // For a click on v0, lookahead is synced to v0's coordinate, so the lookahead
  // segment is effectively the closing edge. mouseMove has already updated
  // state.intersection, so reuse it; block close only when kind='blocking'.
  // (At close time lookahead = v0, so auto-closing is degenerate and only blocking arises.)
  if (state.intersection?.kind === 'blocking') return;
  // Safety net: explicitly re-validate the final closing edge [v_last, v_first].
  // Catches cases the lookahead-based detection misses (e.g. subpixel
  // differences) when the mouseMove lookahead does not exactly equal v0, one
  // more time right before closing.
  const ring = state.polygon.getCoordinates()[0];
  if (
    markClosingIntersection(state, this.map, ring, state.currentVertexPosition)
  ) {
    return;
  }
  this.changeMode('simple_select', {
    featureIds: [state.polygon.id],
  });
}

const DrawPolygon: DrawCustomMode<PolygonState, PolygonOptions> = {
  onSetup(this: DrawCustomModeThis, opts?: PolygonOptions): PolygonState {
    const polygon = this.newFeature({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[]],
      },
    }) as DrawPolygonFeature;

    this.addFeature(polygon);
    this.clearSelectedFeatures();
    doubleClickZoom.disable(this);
    this.updateUIClasses({ mouse: 'add' });
    this.activateUIButton('polygon');
    this.setActionableState({
      trash: true,
      combineFeatures: false,
      uncombineFeatures: false,
    });

    // Register the self-intersection warning source/layers on mode entry; cleaned up in onStop.
    ensureWarningLayer(this.map);

    const state: PolygonState = {
      polygon,
      currentVertexPosition: 0,
      redoStack: [],
      maxVertices: opts?.maxVertices,
    };

    // Double-click finishes the polygon. When clickAnywhere's close branch
    // ignored it because cvp <= MIN, remove the one last-added vertex and
    // commit if unique cvp >= MIN, otherwise keep the mode. When cvp > MIN the
    // close branch already switched to simple_select, and dblclickHandler is
    // off by onStop time, so it never reaches here.
    const handleDoubleClick = (): void => {
      if (state.currentVertexPosition <= 0) return;
      // While blocking, both clicks are blocked so no duplicate vertex is added
      // last; doing cvp-- + trim in that state would drop the user's intended
      // last vertex. visual-only (auto-closing) keeps clicks allowed, so it
      // proceeds to close validation normally.
      if (state.intersection?.kind === 'blocking') return;
      // If the closing edge crosses, block the close. Validate the closing edge
      // of the user's intended polygon (cvp as-is), [v_last_placed, v_first].
      // Validating after the trim would check a polygon missing the vertex the
      // user deliberately placed.
      if (state.currentVertexPosition >= MIN_POLYGON_VERTICES_TO_COMPLETE) {
        const ring = state.polygon.getCoordinates()[0];
        if (
          markClosingIntersection(
            state,
            this.map,
            ring,
            state.currentVertexPosition
          )
        ) {
          return;
        }
      }
      // When the last click added no vertex because maxVertices blocked it,
      // there is no duplicate to remove. (cvp-- would drop the user's intended
      // last vertex, turning N clicks into N-1 vertices.)
      const trimLookahead = !hasReachedMaxVertices(state);
      if (trimLookahead) {
        state.currentVertexPosition--;
        const ring = state.polygon.getCoordinates()[0];
        const trimmed = ring.slice(0, state.currentVertexPosition);
        state.polygon.setCoordinates(trimmed.length > 0 ? [trimmed] : [[]]);
      }
      if (state.currentVertexPosition >= MIN_POLYGON_VERTICES_TO_COMPLETE) {
        this.changeMode('simple_select', { featureIds: [state.polygon.id] });
      } else {
        // Keep-the-mode case: changeMode is not called, so store.render is not
        // auto-triggered.
        this.map.triggerRepaint();
      }
    };

    state.dblclickHandler = handleDoubleClick;
    this.map.on('dblclick', handleDoubleClick);

    return state;
  },

  onClick(
    this: DrawCustomModeThis,
    state: PolygonState,
    e: MapboxDraw.MapMouseEvent
  ): void {
    if (isVertex(e, state.polygon.id)) {
      clickOnVertex.call(this, state);
      return;
    }
    clickAnywhere.call(this, state, e);
  },

  onTap(
    this: DrawCustomModeThis,
    state: PolygonState,
    e: MapboxDraw.MapTouchEvent
  ): void {
    if (isVertex(e, state.polygon.id)) {
      clickOnVertex.call(this, state);
      return;
    }
    clickAnywhere.call(this, state, e);
  },

  onMouseMove(
    this: DrawCustomModeThis,
    state: PolygonState,
    e: MapboxDraw.MapMouseEvent
  ): void {
    state.polygon.updateCoordinate(
      `0.${String(state.currentVertexPosition)}`,
      e.lngLat.lng,
      e.lngLat.lat
    );
    // Check the new edge against existing non-adjacent edges and sync the red
    // warning markers. On a crossing, state.intersection is set, which blocks
    // committing on the click / close paths.
    updateIntersection(state, this.map);
    if (isVertex(e)) {
      this.updateUIClasses({ mouse: 'pointer' });
    }
  },

  onKeyDown(
    this: DrawCustomModeThis,
    state: PolygonState,
    e: KeyboardEvent
  ): void {
    // Ctrl+Z / Ctrl+Shift+Z: undo / redo (handled in keydown to detect modifier keys)
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    if (e.shiftKey) {
      redoLastVertex(state);
    } else {
      removeLastVertex(state);
    }
    // When undo/redo changes the edges/lookahead, re-evaluate the intersection
    // state immediately to avoid a stale display until the next mouseMove.
    updateIntersection(state, this.map);
  },

  onKeyUp(
    this: DrawCustomModeThis,
    state: PolygonState,
    e: KeyboardEvent
  ): void {
    if (e.key === 'Escape') {
      // Two-stage ESC. First: reset only the in-progress polygon, keep the mode. Second: exit the mode.
      if (state.currentVertexPosition > 0) {
        state.polygon.setCoordinates([[]]);
        state.currentVertexPosition = 0;
        state.redoStack = [];
        clearIntersection(state, this.map);
        return;
      }
      this.deleteFeature(String(state.polygon.id), { silent: true });
      this.changeMode('simple_select');
      return;
    }

    if (
      e.key === 'Enter' &&
      state.currentVertexPosition >= MIN_POLYGON_VERTICES_TO_COMPLETE
    ) {
      // Enter close: lookahead sits at the mouse position and is removed in
      // onStop, so separately validate the final closing edge
      // (ring[cvp-1] -> ring[0]) for an intersection.
      const ring = state.polygon.getCoordinates()[0];
      if (
        markClosingIntersection(
          state,
          this.map,
          ring,
          state.currentVertexPosition
        )
      ) {
        return;
      }
      this.changeMode('simple_select', {
        featureIds: [state.polygon.id],
      });
      return;
    }
  },

  onStop(this: DrawCustomModeThis, state: PolygonState): void {
    this.updateUIClasses({ mouse: 'none' });
    doubleClickZoom.enable(this);
    this.activateUIButton();

    if (state.dblclickHandler) {
      this.map.off('dblclick', state.dblclickHandler);
    }

    // A pending RAF firing after the source is removed would make setData a
    // no-op, but cancel it explicitly anyway.
    cancelWarningRender(state);
    removeWarningLayer(this.map);

    if (this.getFeature(String(state.polygon.id)) === undefined) return;

    state.polygon.removeCoordinate(`0.${String(state.currentVertexPosition)}`);

    if (state.polygon.isValid()) {
      this.map.fire('draw.create', {
        features: [state.polygon.toGeoJSON()],
      });
    } else {
      this.deleteFeature(String(state.polygon.id), { silent: true });
      this.changeMode('simple_select', {}, { silent: true });
    }
  },

  toDisplayFeatures(
    this: DrawCustomModeThis,
    state: PolygonState,
    geojson: GeoJSON,
    display: (geojson: GeoJSON) => void
  ): void {
    const feature = geojson as Feature<Polygon>;
    const props = feature.properties as Record<string, unknown>;
    const isActivePolygon = props.id === state.polygon.id;

    props.active = String(isActivePolygon);

    if (!isActivePolygon) {
      display(geojson);
      return;
    }

    // cvp = 0 (no placed vertices): only the lookahead exists, so do not render.
    // (mapbox-gl-draw's Polygon.getCoordinates() returns the ring auto-closed,
    // so inferring progress from ring.length alone gives ringLen=2 even at
    // cvp=0; the polygon's vertex marker would then be drawn before the user
    // even clicks, and the first click landing on that vertex would wrongly
    // trigger the close branch.)
    if (state.currentVertexPosition < 1) return;

    if (feature.geometry.coordinates.length === 0) return;

    const ring = feature.geometry.coordinates[0];
    const coordinateCount = ring.length;

    props.meta = 'feature';

    display(createVertex(state.polygon.id, ring[0], '0.0', false));

    if (coordinateCount > 3) {
      const endPos = ring.length - 3;
      display(
        createVertex(
          state.polygon.id,
          ring[endPos],
          `0.${String(endPos)}`,
          false
        )
      );
    }

    if (coordinateCount <= 4) {
      // Only two coordinates (plus the closing coordinate): render as a LineString
      const lineCoordinates = [
        [ring[0][0], ring[0][1]],
        [ring[1][0], ring[1][1]],
      ];
      display({
        type: 'Feature',
        properties: feature.properties ?? {},
        geometry: {
          coordinates: lineCoordinates,
          type: 'LineString',
        },
      } as Feature<LineString>);
      if (coordinateCount === 3) return;
    }

    display(geojson);
  },

  onTrash(this: DrawCustomModeThis, state: PolygonState): void {
    // With controls.trash true, mapbox-gl-draw's events.keydown delegates
    // Backspace/Delete to mode_handler.trash() -> mode.onTrash() and schedules
    // a store.render() right after. We use this path to map Backspace to
    // removing one vertex. (With 0 vertices, removeLastVertex early-returns on
    // its first line, so exiting the mode is done via ESC pressed twice.)
    removeLastVertex(state);
    updateIntersection(state, this.map);
  },
};

export default DrawPolygon;
