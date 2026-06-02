import type MapboxDraw from '@mapbox/mapbox-gl-draw';
import type { Feature, Polygon } from 'geojson';
import type { Map } from 'mapbox-gl';

import type {
  DrawCustomMode,
  DrawCustomModeThis,
  DrawPolygonFeature,
  RectangleState,
} from '../../types';
import { doubleClickZoom } from '../controls/double-click-zoom';

// Handlers receive events to which mapbox-gl-draw has attached a featureTarget.
// `@types/mapbox__mapbox-gl-draw` declares featureTarget as required, but in
// practice it is absent when clicking outside a feature, so we make it optional.
type DrawPointerEvent = (
  | Omit<MapboxDraw.MapMouseEvent, 'featureTarget'>
  | Omit<MapboxDraw.MapTouchEvent, 'featureTarget'>
) & {
  featureTarget?: MapboxDraw.DrawFeature;
};

interface ModifierKeys {
  altKey: boolean;
  shiftKey: boolean;
}
type CoordTuple = [number, number];
type RectCoords = [CoordTuple, CoordTuple, CoordTuple, CoordTuple, CoordTuple];

const pixelBoundsToCoords = (
  map: Map,
  left: number,
  top: number,
  right: number,
  bottom: number
): RectCoords => {
  const tl = map.unproject([left, top]);
  const tr = map.unproject([right, top]);
  const br = map.unproject([right, bottom]);
  const bl = map.unproject([left, bottom]);
  return [
    [tl.lng, tl.lat],
    [tr.lng, tr.lat],
    [br.lng, br.lat],
    [bl.lng, bl.lat],
    [tl.lng, tl.lat],
  ];
};

/**
 * Computes the 5 corner coordinates of the rectangle for the active modifier
 * key combination.
 * - default: click point as a corner, free aspect ratio
 * - Shift: corner-anchored, 1:1 on screen (square)
 * - Alt (Option): click point as the center, free aspect ratio
 * - Shift+Alt: click point as the center, 1:1 on screen (square)
 *
 * NOTE: square/center calculations run in pixel space and are unprojected back
 * to lng/lat to avoid latitude-dependent distortion.
 */
const computeRectangleCoords = (
  start: CoordTuple,
  current: CoordTuple,
  modifiers: ModifierKeys,
  map: Map
): RectCoords => {
  const isCenter = modifiers.altKey;
  const isSquare = modifiers.shiftKey;

  if (isCenter || isSquare) {
    const startPx = map.project(start);
    const currentPx = map.project(current);
    const rawDx = currentPx.x - startPx.x;
    const rawDy = currentPx.y - startPx.y;
    const adx = Math.abs(rawDx);
    const ady = Math.abs(rawDy);

    if (isCenter) {
      const halfW = isSquare ? Math.max(adx, ady) : adx;
      const halfH = isSquare ? Math.max(adx, ady) : ady;
      return pixelBoundsToCoords(
        map,
        startPx.x - halfW,
        startPx.y - halfH,
        startPx.x + halfW,
        startPx.y + halfH
      );
    }

    // Corner-anchored square: extend by `side` into the quadrant the pointer faces
    const side = Math.max(adx, ady);
    const sx = rawDx >= 0 ? 1 : -1;
    const sy = rawDy >= 0 ? 1 : -1;
    const endX = startPx.x + sx * side;
    const endY = startPx.y + sy * side;
    const left = Math.min(startPx.x, endX);
    const right = Math.max(startPx.x, endX);
    const top = Math.min(startPx.y, endY);
    const bottom = Math.max(startPx.y, endY);
    return pixelBoundsToCoords(map, left, top, right, bottom);
  }

  // Default: corner-anchored, free aspect ratio
  const [startX, startY] = start;
  const [currentX, currentY] = current;

  return [
    [startX, startY],
    [currentX, startY],
    [currentX, currentY],
    [startX, currentY],
    [startX, startY],
  ];
};

const updateRectanglePreview = (
  map: Map,
  state: RectangleState,
  current: CoordTuple,
  modifiers: ModifierKeys
): void => {
  if (!state.startPoint) return;

  const coords = computeRectangleCoords(
    state.startPoint,
    current,
    modifiers,
    map
  );

  coords.forEach(([lng, lat], i) => {
    state.rectangle.updateCoordinate(`0.${i.toString()}`, lng, lat);
  });
};

// While the drawing mode is active, preemptively block the default standalone
// Alt behavior on Windows/Linux browsers (focusing the menu bar) at the
// document capture phase. Added/removed in onSetup/onStop.
const preventAltKeyDefault = (e: KeyboardEvent): void => {
  if (e.key === 'Alt') e.preventDefault();
};

const isSpaceKey = (e: KeyboardEvent): boolean =>
  e.key === ' ' || e.code === 'Space';

// Transient state cleared together when the rectangle is reset via ESC.
const resetPendingRectangle = (state: RectangleState): void => {
  state.startPoint = undefined;
  state.endPoint = undefined;
  state.currentPoint = undefined;
  state.undoneStartPoint = undefined;
  state.undoneCoords = undefined;
  state.spaceAnchor = undefined;
  state.spaceStartAnchor = undefined;
  state.rectangle.setCoordinates([[]]);
};

// When Alt/Shift changes mid-drag, recompute the preview from the stored pointer.
const refreshOnModifierChange = (
  map: Map,
  state: RectangleState,
  e: KeyboardEvent
): void => {
  if (e.repeat) return;
  if (!state.currentPoint) return;
  if (e.key !== 'Alt' && e.key !== 'Shift') return;

  updateRectanglePreview(map, state, state.currentPoint, {
    altKey: e.altKey,
    shiftKey: e.shiftKey,
  });
};

function onMouseMove(
  this: DrawCustomModeThis,
  state: RectangleState,
  e: DrawPointerEvent
): void {
  if (!state.startPoint) return;

  const current: CoordTuple = [e.lngLat.lng, e.lngLat.lat];

  // While Space is held: translate the rectangle.
  // Move startPoint by the same delta, relative to the (mouse / startPoint) captured at anchor time.
  if (state.spaceAnchor && state.spaceStartAnchor) {
    const dx = current[0] - state.spaceAnchor[0];
    const dy = current[1] - state.spaceAnchor[1];
    state.startPoint = [
      state.spaceStartAnchor[0] + dx,
      state.spaceStartAnchor[1] + dy,
    ];
  }

  state.currentPoint = current;

  updateRectanglePreview(this.map, state, current, {
    altKey: e.originalEvent.altKey,
    shiftKey: e.originalEvent.shiftKey,
  });
}

function onClick(
  this: DrawCustomModeThis,
  state: RectangleState,
  e: DrawPointerEvent
): void {
  const isSecondClick =
    state.startPoint &&
    (state.startPoint[0] !== e.lngLat.lng ||
      state.startPoint[1] !== e.lngLat.lat);

  if (isSecondClick) {
    this.updateUIClasses({ mouse: 'pointer' });
    state.endPoint = [e.lngLat.lng, e.lngLat.lat];
    this.changeMode('simple_select', {
      featuresId: String(state.rectangle.id),
    });
    return;
  }

  const startPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
  state.startPoint = startPoint;
  state.undoneStartPoint = undefined;
  state.undoneCoords = undefined;
}

const DrawRectangle: DrawCustomMode<RectangleState> = {
  onSetup(this: DrawCustomModeThis): RectangleState {
    const rectangle = this.newFeature({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[]],
      },
    }) as DrawPolygonFeature;

    this.addFeature(rectangle);
    this.clearSelectedFeatures();
    doubleClickZoom.disable(this);
    this.updateUIClasses({ mouse: 'add' });
    this.setActionableState({
      trash: true,
      combineFeatures: false,
      uncombineFeatures: false,
    });

    document.addEventListener('keydown', preventAltKeyDefault, true);
    document.addEventListener('keyup', preventAltKeyDefault, true);

    return { rectangle };
  },
  // Mobile tap support: emulate mouse move (to update coords) then click
  onTap(
    this: DrawCustomModeThis,
    state: RectangleState,
    e: MapboxDraw.MapTouchEvent
  ): void {
    if (state.startPoint) {
      onMouseMove.call(this, state, e);
    }
    onClick.call(this, state, e);
  },
  onClick,
  onMouseMove,
  onKeyDown(
    this: DrawCustomModeThis,
    state: RectangleState,
    e: KeyboardEvent
  ): void {
    // Space: lock the translation anchor. Also blocks page scroll.
    if (isSpaceKey(e)) {
      e.preventDefault();
      if (e.repeat) return;
      if (state.startPoint && state.currentPoint) {
        state.spaceAnchor = state.currentPoint;
        state.spaceStartAnchor = state.startPoint;
      }
      return;
    }

    // Ctrl+Z / Ctrl+Shift+Z: undo / redo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        // redo: restore startPoint and the rectangle coordinates together
        if (state.undoneStartPoint) {
          state.startPoint = state.undoneStartPoint;
          state.undoneStartPoint = undefined;
          if (state.undoneCoords) {
            state.rectangle.setCoordinates(state.undoneCoords);
            state.undoneCoords = undefined;
          }
        }
      } else {
        // undo: back up the coordinates for redo, then clear
        if (state.startPoint) {
          state.undoneStartPoint = state.startPoint;
          state.undoneCoords = state.rectangle.getCoordinates();
          state.startPoint = undefined;
          state.rectangle.setCoordinates([[]]);
        }
      }
      return;
    }

    // Recompute the preview on modifier change (Alt/Shift)
    refreshOnModifierChange(this.map, state, e);
  },
  onKeyUp(
    this: DrawCustomModeThis,
    state: RectangleState,
    e: KeyboardEvent
  ): void {
    // Space release: clear the anchor
    if (isSpaceKey(e)) {
      state.spaceAnchor = undefined;
      state.spaceStartAnchor = undefined;
      return;
    }

    // Two-stage ESC. First: reset only the pending rectangle, keep the mode. Second: exit the mode.
    if (e.code === 'Escape') {
      if (state.startPoint) {
        resetPendingRectangle(state);
        return;
      }
      this.changeMode('simple_select');
      return;
    }

    refreshOnModifierChange(this.map, state, e);
  },
  onStop(this: DrawCustomModeThis, state: RectangleState): void {
    document.removeEventListener('keydown', preventAltKeyDefault, true);
    document.removeEventListener('keyup', preventAltKeyDefault, true);

    doubleClickZoom.enable(this);
    this.updateUIClasses({ mouse: 'none' });
    this.activateUIButton();

    // Bail out if the feature was already deleted
    if (this.getFeature(String(state.rectangle.id)) === undefined) return;

    state.rectangle.removeCoordinate('0.4');
    if (state.rectangle.isValid()) {
      this.map.fire('draw.create', {
        features: [state.rectangle.toGeoJSON()],
      });
    } else {
      this.deleteFeature(String(state.rectangle.id), { silent: true });
      this.changeMode('simple_select', {}, { silent: true });
    }
  },
  toDisplayFeatures(
    this: DrawCustomModeThis,
    state: RectangleState,
    geojson: Feature,
    display: (geojson: Feature) => void
  ): void {
    const geoJsonFeature = geojson as Feature<
      Polygon,
      { id: string | number; active?: string }
    >;
    const isActivePolygon = geoJsonFeature.properties.id === state.rectangle.id;
    geoJsonFeature.properties.active = isActivePolygon ? 'true' : 'false';
    if (!isActivePolygon) {
      display(geojson);
      return;
    }

    // Only render the rectangle polygon once a start point exists
    if (!state.startPoint) return;
    display(geojson);
  },
  onTrash(this: DrawCustomModeThis, state: RectangleState): void {
    // With controls.trash: true, events.keydown delegates Backspace/Delete to onTrash.
    // For a pending rectangle (only startPoint, before the second click), just reset
    // and keep the mode, matching the first stage of the two-stage ESC. If there is no
    // startPoint, exit the mode.
    if (state.startPoint) {
      resetPendingRectangle(state);
      return;
    }
    this.deleteFeature(String(state.rectangle.id), { silent: true });
    this.changeMode('simple_select');
  },
};

export default DrawRectangle;
