import { Map } from 'mapbox-gl';
import type { CompareEventType, CompareOptions, SlideEndEvent } from '../types';
import { EventEmitter } from './event-emitter';
import { syncMove } from './sync-move';

type CompareContainer = string | HTMLElement;

// The inline style properties Compare writes on a map container. Snapshotted
// before the first write so remove() can hand the container back untouched.
const STYLED_PROPERTIES = [
  'clipPath',
  'pointerEvents',
  'position',
  'zIndex',
] as const;

type ContainerStyles = Pick<
  CSSStyleDeclaration,
  (typeof STYLED_PROPERTIES)[number]
>;

// The hover path (options.mousemove) delivers plain MouseEvents, the drag path
// PointerEvents; only the latter carry an id worth filtering on.
const isPointerEvent = (e: MouseEvent): e is PointerEvent => 'pointerId' in e;

/** Where the divider sits when the caller does not say. */
const DEFAULT_RATIO = 0.5;

/** The divider's travel limits, resolved to a ratio at each end. */
interface TravelLimits {
  min: number;
  max: number;
}

// Clamps a caller-supplied ratio into 0–1, falling back when it is absent or
// non-finite. Resolved once at construction rather than on every drag frame: a
// NaN limit would poison every later position, and through the stored ratio
// every later resize too.
const clampRatio = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.min(Math.max(value, 0), 1);

/**
 * Resolves the divider's travel limits. `bounds` wins when given; `minRatio`
 * stays supported as the symmetric shorthand it has always been.
 */
const resolveLimits = (options: CompareOptions): TravelLimits => {
  if (options.bounds) {
    const min = clampRatio(options.bounds.min, 0);
    // An inverted range pins the divider at `min` rather than quietly swapping
    // the ends: the caller sees the mistake, and the divider still has one
    // defined place to sit.
    return { min, max: Math.max(min, clampRatio(options.bounds.max, 1)) };
  }

  const minRatio = Math.min(clampRatio(options.minRatio, 0), 0.5);
  return { min: minRatio, max: 1 - minRatio };
};

/**
 * Swipe-to-compare slider between two synchronized maps.
 *
 * An instance owns both map containers for its lifetime: it snapshots their
 * inline styles on construction and writes them back in {@link Compare.remove}.
 * Use one instance per container pair at a time — overlapping instances over
 * the same maps would snapshot each other's styles as the originals.
 */
export class Compare {
  private _mapA: Map;
  private _mapB: Map;
  private _swiper: HTMLElement;
  private _controlContainer: HTMLElement;
  // Last measured geometry of the map container. Cached rather than measured
  // per frame, so every position in this class is derived from one snapshot.
  private _rect: DOMRect;
  private _horizontal: boolean;
  private _limits: TravelLimits;
  private _clearSync: () => void;
  private _onResize: () => void;
  private _ev: EventEmitter;
  private _onDown: (e: PointerEvent) => void;
  private _onMove: (e: MouseEvent) => void;
  private _onEnd: (e: PointerEvent) => void;
  // Id of the pointer dragging the handle, null when no drag is in progress
  private _pointerId: number | null = null;
  private _savedStyles = new WeakMap<HTMLElement, ContainerStyles>();
  // Split ratio (0–1) of the container extent, and the source of truth across
  // resizes: a container that momentarily reports a zero extent (hidden tab,
  // display:none) cannot destroy the split.
  private _ratio: number;
  // The same split in px along the axis, from the container's start edge. Kept
  // so getPosition and the slideend payload report exactly what was last
  // written rather than recomputing it against a possibly newer extent.
  private _position = 0;

  constructor(
    mapA: Map,
    mapB: Map,
    container: CompareContainer,
    options: CompareOptions = {}
  ) {
    // Resolve the target element first. A bad selector has to throw before
    // anything below has written to the page or to either map.
    const target =
      typeof container === 'string'
        ? document.querySelector<HTMLElement>(container)
        : container;
    if (!target) throw new Error('Container not found');

    this._mapA = mapA;
    this._mapB = mapB;
    this._horizontal = options.orientation === 'horizontal';
    this._limits = resolveLimits(options);
    this._ratio = clampRatio(options.initialRatio, DEFAULT_RATIO);
    this._ev = new EventEmitter();
    this._onDown = this._handleDown.bind(this);
    this._onMove = this._handleMove.bind(this);
    this._onEnd = this._handleEnd.bind(this);

    // Capture the containers' own inline styles before anything below writes to them
    this._snapshotContainer(mapA);
    this._snapshotContainer(mapB);

    // Link the cameras before any DOM is mutated. syncMove now jumps the second
    // map at setup, which fires that map's own move events synchronously, so a
    // consumer handler throwing out of one would abandon the constructor. That
    // must not be able to leave half-styled containers behind, with remove()
    // unreachable because `new` never returned. Nothing above this line has
    // written to the page, and syncMove aligns before it registers anything, so
    // a throw there leaves no listeners either.
    this._clearSync = syncMove(mapA, mapB);

    this._swiper = document.createElement('div');
    this._swiper.className = this._horizontal
      ? 'compare-swiper-horizontal'
      : 'compare-swiper-vertical';
    // Without this the browser claims touch drags for panning and sends
    // pointercancel instead of pointermove
    this._swiper.style.touchAction = 'none';

    this._controlContainer = document.createElement('div');
    this._controlContainer.className = this._horizontal
      ? 'mapboxgl-compare mapboxgl-compare-horizontal'
      : 'mapboxgl-compare';
    this._controlContainer.appendChild(this._swiper);

    target.appendChild(this._controlContainer);

    // Style the containers before the first measurement, so every measurement
    // in this class reads the same styled layout: the constructor here,
    // `resize`, and the start of each drag.
    // Keep both maps interactive, and stack them at the same z-index so
    // neither sits above the other.
    this._styleContainer(mapA);
    this._styleContainer(mapB);

    this._rect = mapB.getContainer().getBoundingClientRect();
    this._setRatio(this._ratio);

    this._onResize = () => {
      this._rect = mapB.getContainer().getBoundingClientRect();
      // Re-derive pixels from the ratio: the split stays proportional instead
      // of sticking to a pixel offset that no longer means the same thing.
      this._setRatio(this._ratio);
    };

    mapB.on('resize', this._onResize);

    if (options.mousemove) {
      mapA.getContainer().addEventListener('mousemove', this._onMove);
      mapB.getContainer().addEventListener('mousemove', this._onMove);
    }

    this._swiper.addEventListener('pointerdown', this._onDown);
  }

  private get _extent(): number {
    return this._horizontal ? this._rect.height : this._rect.width;
  }

  private _snapshotContainer(map: Map): void {
    const el = map.getContainer();
    const { style } = el;
    const snapshot = {} as Record<string, string>;
    for (const property of STYLED_PROPERTIES) {
      snapshot[property] = style[property];
    }
    this._savedStyles.set(el, snapshot as ContainerStyles);
  }

  private _styleContainer(map: Map): void {
    const { style } = map.getContainer();
    style.pointerEvents = 'auto';
    style.position = 'absolute';
    style.zIndex = '1';
  }

  // Restores the inline styles and hover listener Compare put on a map
  // container. mapA in particular is often the app's reusable main map, so
  // leaving `position: absolute` behind would affect later layout and control
  // placement.
  private _restoreContainer(map: Map): void {
    const el = map.getContainer();
    const saved = this._savedStyles.get(el);
    for (const property of STYLED_PROPERTIES) {
      el.style[property] = saved?.[property] ?? '';
    }
    // Symmetrically drop the hover listener added for options.mousemove
    // (a no-op when it was never attached)
    el.removeEventListener('mousemove', this._onMove);
  }

  // Places the divider at `ratio` of the container extent.
  private _setRatio(ratio: number): void {
    this._setPosition(ratio * this._extent);
  }

  private _setPosition(x: number) {
    const extent = this._extent;
    // A zero extent (hidden tab or collapsed panel) has no meaningful position:
    // applying one would un-clip both maps, and dividing by it would poison the
    // stored ratio. Leave the current clip in place and let the next non-zero
    // resize re-derive it from the ratio that survives here.
    if (extent <= 0) return;

    // Once the divider reaches a limit it pins there and cannot be pushed
    // further that way.
    const position = Math.min(
      Math.max(x, extent * this._limits.min),
      extent * this._limits.max
    );

    this._controlContainer.style.transform = this._horizontal
      ? `translate(0, ${position.toString()}px)`
      : `translate(${position.toString()}px, 0)`;

    // Clip each map's visible area with clipPath to create the split effect
    const clipPathA = this._horizontal
      ? `inset(0 0 ${(this._rect.height - position).toString()}px 0)`
      : `inset(0 ${(this._rect.width - position).toString()}px 0 0)`;
    const clipPathB = this._horizontal
      ? `inset(${position.toString()}px 0 0 0)`
      : `inset(0 0 0 ${position.toString()}px)`;

    this._mapA.getContainer().style.clipPath = clipPathA;
    this._mapB.getContainer().style.clipPath = clipPathB;

    this._position = position;
    this._ratio = position / extent;
  }

  // Pointer offset along the split axis, relative to the map container.
  // Not clamped here — _setPosition applies the authoritative bounds.
  private _getPosition(e: MouseEvent): number {
    return this._horizontal
      ? e.clientY - this._rect.top
      : e.clientX - this._rect.left;
  }

  private _handleDown(e: PointerEvent): void {
    // Only a primary press drags. Mouse right / middle buttons report a
    // non-zero button and would open menus that never deliver a matching
    // pointerup; touch contacts and the pen tip report 0.
    if (e.button !== 0) return;
    // One drag at a time: a second pointer landing on the handle must not take
    // over and strand the one already holding it.
    if (this._pointerId !== null) return;
    e.preventDefault();

    // Re-measure: the container can move without resizing (page scroll, a
    // sibling panel opening), and a stale origin would offset the whole drag.
    this._rect = this._mapB.getContainer().getBoundingClientRect();

    // Capturing routes every later move / up / cancel for this pointer to the
    // swiper, whatever the cursor is over, keeping the drag alive outside the
    // handle without document-level listeners. Claim it before recording the
    // drag, so a failed capture leaves no half-started state behind.
    this._swiper.setPointerCapture(e.pointerId);
    this._pointerId = e.pointerId;
    this._swiper.addEventListener('pointermove', this._onMove);
    this._swiper.addEventListener('pointerup', this._onEnd);
    this._swiper.addEventListener('pointercancel', this._onEnd);
    // Capture can also be lost without either of those — the swiper being
    // detached mid-drag, say — and the drag must not stay marked as live, or
    // every later press would be refused with no way to recover.
    this._swiper.addEventListener('lostpointercapture', this._onEnd);
  }

  private _handleMove(e: MouseEvent): void {
    // Capture retargets only the captured pointer. Any other pointer over the
    // handle — a second finger, or a mouse / hovering pen on a hybrid device —
    // still hit-tests to it and would otherwise snap the divider to itself.
    if (
      this._pointerId !== null &&
      isPointerEvent(e) &&
      e.pointerId !== this._pointerId
    ) {
      return;
    }
    this._setPosition(this._getPosition(e));
  }

  // Ends the drag if one is in progress. Safe to call at any time, including
  // from remove() while the pointer is still down.
  private _stopDrag(): void {
    const pointerId = this._pointerId;
    if (pointerId === null) return;
    this._pointerId = null;

    this._swiper.removeEventListener('pointermove', this._onMove);
    this._swiper.removeEventListener('pointerup', this._onEnd);
    this._swiper.removeEventListener('pointercancel', this._onEnd);
    this._swiper.removeEventListener('lostpointercapture', this._onEnd);
    // Capture is released implicitly on pointerup / pointercancel, so only an
    // still-held pointer (teardown mid-drag) needs this.
    if (this._swiper.hasPointerCapture(pointerId)) {
      this._swiper.releasePointerCapture(pointerId);
    }
  }

  private _handleEnd(e: PointerEvent): void {
    // Another pointer pressed on the handle is still targeted at the swiper
    // even though it never became the drag, so its release lands here too.
    if (e.pointerId !== this._pointerId) return;
    this._stopDrag();
    this.fire('slideend', { currentPosition: this._position });
  }

  /**
   * Current divider offset in px along the split axis, measured from the
   * container's start edge (left for a vertical split, top for a horizontal
   * one).
   */
  public getPosition(): number {
    return this._position;
  }

  /**
   * Moves the divider to `px` along the split axis, clamped to the configured
   * bounds. A no-op while the container reports a zero extent.
   *
   * This does not fire `slideend`. That event reports the end of a user
   * gesture, and a caller moving the divider itself already knows where it put
   * it.
   */
  public setPosition(px: number): void {
    // A non-finite offset would clamp to NaN, un-clip both maps, and poison
    // every later resize through the stored ratio.
    if (!Number.isFinite(px)) return;
    this._setPosition(px);
  }

  public on(type: CompareEventType, fn: (e: SlideEndEvent) => void): this {
    this._ev.on(type, fn);
    return this;
  }

  public fire(type: CompareEventType, data: SlideEndEvent): this {
    this._ev.emit(type, data);
    return this;
  }

  public off(type: CompareEventType, fn: (e: SlideEndEvent) => void): this {
    this._ev.removeListener(type, fn);
    return this;
  }

  public remove(): void {
    this._clearSync();
    this._mapB.off('resize', this._onResize);

    this._restoreContainer(this._mapA);
    this._restoreContainer(this._mapB);

    this._swiper.removeEventListener('pointerdown', this._onDown);
    // If remove() runs mid-drag (e.g. a route change while the handle is held),
    // the captured pointer would keep delivering moves to a detached swiper and
    // run _handleMove against a removed map.
    this._stopDrag();
    this._controlContainer.remove();
  }
}
