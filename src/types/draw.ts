/**
 * MapboxDraw type definitions.
 * The types shipped with @mapbox/mapbox-gl-draw are thin, so these augment
 * them for a strict environment.
 *
 * Types here are defined to be structurally assignable to the same-named types
 * in `@types/mapbox__mapbox-gl-draw`. As a result, consumers can register this
 * package's mode objects directly on `MapboxDraw.modes` without an
 * `as MapboxDraw.DrawCustomMode` assertion.
 *
 * Key rules for staying compatible:
 * 1. `toDisplayFeatures` is required (same as the upstream type).
 * 2. Every mode method's `this` uses the `DrawCustomModeThis & this` pattern.
 *    The second `this` lets a mode call extra methods it defines on itself via
 *    `this.foo()`.
 * 3. `DrawFeatureBase.properties` / `id` / `type` are readonly.
 * 4. `DrawFeatureBase.incomingCoords` is exposed (same as the upstream type).
 *
 * @see https://github.com/mapbox/mapbox-gl-draw
 */

import type { Feature, GeoJSON, GeoJsonTypes, Position } from 'geojson';
import type { Map, MapMouseEvent, MapTouchEvent } from 'mapbox-gl';

/** Base interface for a Draw feature. */
interface DrawFeatureBase<Coordinates> {
  readonly id: NonNullable<Feature['id']>;
  readonly type: GeoJsonTypes;
  readonly properties: Readonly<Feature['properties']>;
  readonly coordinates: Coordinates;

  changed(): void;
  isValid(): boolean;
  /** Alias used internally by mapbox-gl-draw, identical to setCoordinates. */
  incomingCoords: this['setCoordinates'];
  setCoordinates(coords: Coordinates): void;
  getCoordinates(): Coordinates;
  getCoordinate(path: string): Position;
  updateCoordinate(path: string, lng: number, lat: number): void;
  setProperty(property: string, value: unknown): void;
  toGeoJSON(): GeoJSON;
}

/** Draw polygon feature type. */
export interface DrawPolygonFeature extends DrawFeatureBase<Position[][]> {
  readonly type: 'Polygon';
  addCoordinate(path: string, lng: number, lat: number): void;
  removeCoordinate(path: string): void;
}

/**
 * The Multi variants of `MapboxDraw.DrawFeature` (`MultiPoint` /
 * `MultiLineString` / `MultiPolygon`) have no `coordinates` field (they use a
 * `features` array instead). To stay assignable both ways, the union includes
 * a generic variant where `coordinates` may be absent.
 */
interface DrawFeatureLoose extends Omit<
  DrawFeatureBase<unknown>,
  'coordinates'
> {
  readonly coordinates?: unknown;
}

/** Draw feature union type (extensible). */
export type DrawFeature = DrawPolygonFeature | DrawFeatureLoose;

/**
 * MapboxDraw options (structurally compatible with
 * `MapboxDraw.MapboxDrawOptions`).
 *
 * Used as the `drawConfig` field type. Every key is optional, so it stays
 * assignable both ways with the upstream `MapboxDrawOptions`.
 */
export interface DrawConfig {
  displayControlsDefault?: boolean;
  keybindings?: boolean;
  touchEnabled?: boolean;
  boxSelect?: boolean;
  clickBuffer?: number;
  touchBuffer?: number;
  controls?: object;
  styles?: object[];
  modes?: Record<string, unknown>;
  defaultMode?: string;
  userProperties?: boolean;
}

/**
 * The `this` context type for a DrawCustomMode (MapboxDraw compatible).
 *
 * Method signatures are kept aligned with the upstream
 * `MapboxDraw.DrawCustomModeThis` to stay assignable both ways.
 */
export interface DrawCustomModeThis {
  map: Map;
  drawConfig: DrawConfig;

  // Feature management
  newFeature(geojson: GeoJSON): DrawFeature;
  addFeature(feature: DrawFeature): void;
  delete(id: string): void;
  deleteFeature(id: string, opts?: { silent?: boolean }): void;
  getFeature(id: string): DrawFeature | undefined;

  // Selection
  setSelected(features?: string | string[]): void;
  setSelectedCoordinates(
    coords: { coord_path: string; feature_id: string }[]
  ): void;
  getSelected(): DrawFeature[];
  getSelectedIds(): string[];
  isSelected(id: string): boolean;
  select(id: string): void;
  clearSelectedFeatures(): void;
  clearSelectedCoordinates(): void;

  // UI
  updateUIClasses(opts: object): void;
  activateUIButton(name?: string): void;
  setActionableState(opts: {
    trash: boolean;
    combineFeatures: boolean;
    uncombineFeatures: boolean;
  }): void;

  // Mode
  changeMode(mode: string, options?: object, extras?: object): void;

  // Utils
  featuresAt(
    event: Event,
    bbox: [number, number, number, number],
    bufferType: 'click' | 'tap'
  ): DrawFeature[];
  isInstanceOf(type: string, feature: object): boolean;
  doRender(id: string): void;
}

/**
 * Custom Draw mode interface (MapboxDraw compatible).
 *
 * The `this: DrawCustomModeThis & this` pattern matches the upstream
 * `MapboxDraw.DrawCustomMode`. The second `this` is the mode object's
 * self-type, used when a mode calls extra methods it defines on itself via
 * `this.foo()`.
 */
export interface DrawCustomMode<
  State = Record<string, unknown>,
  Options = Record<string, unknown>,
> {
  onSetup?(this: DrawCustomModeThis & this, opts: Options): State;

  onClick?(
    this: DrawCustomModeThis & this,
    state: State,
    e: MapMouseEvent
  ): void;
  onTap?(this: DrawCustomModeThis & this, state: State, e: MapTouchEvent): void;
  onMouseMove?(
    this: DrawCustomModeThis & this,
    state: State,
    e: MapMouseEvent
  ): void;
  onMouseDown?(
    this: DrawCustomModeThis & this,
    state: State,
    e: MapMouseEvent
  ): void;
  onMouseUp?(
    this: DrawCustomModeThis & this,
    state: State,
    e: MapMouseEvent
  ): void;
  onMouseOut?(
    this: DrawCustomModeThis & this,
    state: State,
    e: MapMouseEvent
  ): void;
  onKeyUp?(
    this: DrawCustomModeThis & this,
    state: State,
    e: KeyboardEvent
  ): void;
  onKeyDown?(
    this: DrawCustomModeThis & this,
    state: State,
    e: KeyboardEvent
  ): void;
  onTouchStart?(
    this: DrawCustomModeThis & this,
    state: State,
    e: MapTouchEvent
  ): void;
  onTouchMove?(
    this: DrawCustomModeThis & this,
    state: State,
    e: MapTouchEvent
  ): void;
  onTouchEnd?(
    this: DrawCustomModeThis & this,
    state: State,
    e: MapTouchEvent
  ): void;
  onDrag?(
    this: DrawCustomModeThis & this,
    state: State,
    e: MapMouseEvent
  ): void;
  onStop?(this: DrawCustomModeThis & this, state: State): void;
  onTrash?(this: DrawCustomModeThis & this, state: State): void;
  onCombineFeature?(this: DrawCustomModeThis & this, state: State): void;
  onUncombineFeature?(this: DrawCustomModeThis & this, state: State): void;

  toDisplayFeatures(
    this: DrawCustomModeThis & this,
    state: State,
    geojson: GeoJSON,
    display: (geojson: GeoJSON) => void
  ): void;
}

/** Rectangle Draw mode state. */
export interface RectangleState {
  rectangle: DrawPolygonFeature;
  startPoint?: [number, number];
  endPoint?: [number, number];
  undoneStartPoint?: [number, number];
  // Backup taken at undo time so redo (Ctrl+Shift+Z) can restore the rectangle coordinates too
  undoneCoords?: Position[][];
  // Last pointer position, kept so the preview can be recomputed when a modifier key changes
  currentPoint?: [number, number];
  // Space + drag translation: anchors the mouse and startPoint coordinates captured when Space was pressed
  spaceAnchor?: [number, number];
  spaceStartAnchor?: [number, number];
}
/** Polygon Draw mode options (consumer passes these as changeMode's second argument). */
export interface PolygonOptions {
  // Vertex cap (a policy value). Unbounded if unset.
  maxVertices?: number;
}

/**
 * Self-intersection info for a freehand polygon.
 *
 * When present, a red warning is shown. It is recomputed on every mouseMove,
 * and the red-warning source managed by the mode is synced at the same time.
 *
 * - `point`: intersection coordinate (red marker position)
 * - `newSegment`: the lookahead/closing/auto-closing edge (highlighted red)
 * - `existingSegment`: the existing edge that is crossed (highlighted red)
 * - `kind`:
 *   - `'blocking'`: the new edge (lookahead segment) or the closing edge (at
 *     close time) intersects, so committing a vertex or closing is blocked.
 *     The user must move before continuing.
 *   - `'visual-only'`: the auto-closing edge intersects, so only the red
 *     warning shows and clicks are still allowed. A transient state that may
 *     resolve once the user adds more vertices.
 */
export interface PolygonIntersection {
  point: Position;
  newSegment: [Position, Position];
  existingSegment: [Position, Position];
  kind: 'blocking' | 'visual-only';
}

/** Polygon Draw mode state. */
export interface PolygonState {
  polygon: DrawPolygonFeature;
  currentVertexPosition: number;
  redoStack: [number, number][];
  maxVertices?: number;
  // Double-click finishes the polygon. The mapbox-gl Map handler is registered in onSetup and cleaned up in onStop.
  dblclickHandler?: (e: MapMouseEvent) => void;
  // Self-intersection info. See the PolygonIntersection doc comment for details.
  intersection?: PolygonIntersection;
  // Handle used to defer the red-warning source update to the next RAF.
  // mapbox-gl-draw also flushes its polygon source on a RAF, so this keeps both painted in the same frame.
  pendingWarningRaf?: number;
}

/** DoubleClickZoom control interface. */
export interface DoubleClickZoomControl {
  enable: (ctx: DrawCustomModeThis) => void;
  disable: (ctx: DrawCustomModeThis) => void;
}
