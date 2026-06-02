/**
 * A direct_select mode that adds self-intersection validation when editing a
 * committed polygon.
 *
 * Wraps mapbox-gl-draw's default direct_select to check polygon
 * self-intersection in real time during vertex / midpoint drags. Shares the
 * same red-warning visualization as the drawing mode (reusing the source/layer
 * from `polygon-intersection`).
 *
 * Behavior:
 * - shows the red warning when the polygon becomes self-intersecting mid-drag
 * - reverts to the pre-drag coordinates if invalid at drag end (mouseUp),
 *   ensuring the polygon always stays in a simple state
 */

import MapboxDraw from '@mapbox/mapbox-gl-draw';
import type { Position } from 'geojson';
import type { Map, MapMouseEvent } from 'mapbox-gl';

import type { PolygonIntersection } from '../../types';
import {
  cancelWarningRender,
  ensureWarningLayer,
  findFirstSelfIntersection,
  removeWarningLayer,
  scheduleWarningRender,
} from './polygon-intersection';

// The default direct_select state plus our extra fields.
// mapbox-gl-draw treats state as any, so we only type the minimum we need.
interface DirectSelectState {
  feature: {
    getCoordinates(): Position[][];
    setCoordinates(coords: Position[][]): void;
  };
  selectedCoordPaths: string[];
  canDragMove?: boolean;
  // Our additions
  intersection?: PolygonIntersection;
  pendingWarningRaf?: number;
  coordsBeforeDrag?: Position[][];
}

// Deep-copies the polygon rings for a drag-start snapshot (to support revert).
const cloneCoordinates = (coords: Position[][]): Position[][] =>
  coords.map((ring) => ring.map((pt) => [pt[0], pt[1]]));

const validateAndUpdate = (state: DirectSelectState, map: Map): void => {
  const coords = state.feature.getCoordinates();
  if (coords.length === 0) return;
  const ring = coords[0];
  const info = findFirstSelfIntersection(ring);
  // Avoid scheduling a RAF when nothing changed (same policy as updateIntersection in drawing)
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

const baseDirectSelect = MapboxDraw.modes.direct_select;

// The `this` / state types are the context mapbox-gl-draw binds when calling
// mode methods. The upstream @types treat them as any, so we add only minimal typing.
interface ModeThis {
  map: Map;
}

const DirectSelectWithIntersection = {
  ...baseDirectSelect,

  onSetup(this: ModeThis, opts: unknown): DirectSelectState {
    const state = (
      baseDirectSelect.onSetup as (opts: unknown) => DirectSelectState
    ).call(this, opts);
    ensureWarningLayer(this.map);
    return state;
  },

  onStop(this: ModeThis, state: DirectSelectState): void {
    cancelWarningRender(state);
    removeWarningLayer(this.map);
    (
      baseDirectSelect.onStop as
        | ((state: DirectSelectState) => void)
        | undefined
    )?.call(this, state);
  },

  onMouseDown(
    this: ModeThis,
    state: DirectSelectState,
    e: MapMouseEvent
  ): void {
    (
      baseDirectSelect.onMouseDown as (
        state: DirectSelectState,
        e: MapMouseEvent
      ) => void
    ).call(this, state, e);
    // Right after the default sets canDragMove: snapshot coords if a drag may start.
    // A non-empty selectedCoordPaths means a vertex / midpoint is grabbed.
    if (state.canDragMove && state.selectedCoordPaths.length > 0) {
      state.coordsBeforeDrag = cloneCoordinates(state.feature.getCoordinates());
    }
  },

  onDrag(this: ModeThis, state: DirectSelectState, e: MapMouseEvent): void {
    (
      baseDirectSelect.onDrag as
        | ((state: DirectSelectState, e: MapMouseEvent) => void)
        | undefined
    )?.call(this, state, e);
    if (state.selectedCoordPaths.length > 0) {
      validateAndUpdate(state, this.map);
    }
  },

  onMouseUp(this: ModeThis, state: DirectSelectState, e: MapMouseEvent): void {
    // At drag end, if invalid (blocking) revert to the pre-drag coords.
    // visual-only never arises in the direct_select context (no auto-closing concept).
    if (
      state.intersection?.kind === 'blocking' &&
      state.coordsBeforeDrag !== undefined
    ) {
      state.feature.setCoordinates(state.coordsBeforeDrag);
      state.intersection = undefined;
      scheduleWarningRender(state, this.map);
    }
    state.coordsBeforeDrag = undefined;
    (
      baseDirectSelect.onMouseUp as
        | ((state: DirectSelectState, e: MapMouseEvent) => void)
        | undefined
    )?.call(this, state, e);
  },
};

export default DirectSelectWithIntersection;
