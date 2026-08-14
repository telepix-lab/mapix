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

export class Compare {
  private _mapA: Map;
  private _mapB: Map;
  private _swiper: HTMLElement;
  private _controlContainer: HTMLElement;
  private _bounds: DOMRect;
  private _horizontal: boolean;
  private _minRatio: number;
  private _clearSync: () => void;
  private _onResize: () => void;
  private _ev: EventEmitter;
  private _onDown: (e: MouseEvent | TouchEvent) => void;
  private _onMove: (e: MouseEvent | TouchEvent) => void;
  private _onEnd: () => void;
  private _savedStyles = new WeakMap<HTMLElement, ContainerStyles>();
  // Split ratio (0–1) of the container extent. This — not currentPosition —
  // is the source of truth across resizes, so a container that momentarily
  // reports a zero extent (hidden tab, display:none) cannot destroy the split.
  private _ratio = 0.5;
  private currentPosition: number | null;

  constructor(
    mapA: Map,
    mapB: Map,
    container: CompareContainer,
    options: CompareOptions = {}
  ) {
    this._mapA = mapA;
    this._mapB = mapB;
    this._horizontal = options.orientation === 'horizontal';
    // Reserved at each end, so the divider always leaves this much of both
    // sides visible. Clamped once here rather than on every drag frame.
    this._minRatio = Math.min(Math.max(options.minRatio ?? 0, 0), 0.5);
    this._ev = new EventEmitter();
    this._onDown = this._handleDown.bind(this);
    this._onMove = this._handleMove.bind(this);
    this._onEnd = this._handleEnd.bind(this);
    this.currentPosition = null;

    // Capture the containers' own inline styles before anything below writes to them
    this._snapshotContainer(mapA);
    this._snapshotContainer(mapB);

    this._swiper = document.createElement('div');
    this._swiper.className = this._horizontal
      ? 'compare-swiper-horizontal'
      : 'compare-swiper-vertical';

    this._controlContainer = document.createElement('div');
    this._controlContainer.className = this._horizontal
      ? 'mapboxgl-compare mapboxgl-compare-horizontal'
      : 'mapboxgl-compare';
    this._controlContainer.appendChild(this._swiper);

    if (typeof container === 'string') {
      const el = document.querySelector<HTMLElement>(container);
      if (!el) throw new Error('Container not found');
      el.appendChild(this._controlContainer);
    } else {
      container.appendChild(this._controlContainer);
    }

    // Measure before the containers become absolutely positioned below, so the
    // rect still reflects the layout-driven size
    this._bounds = mapB.getContainer().getBoundingClientRect();
    this._applyRatio();

    this._clearSync = syncMove(mapA, mapB);
    this._onResize = () => {
      this._bounds = mapB.getContainer().getBoundingClientRect();
      // Re-derive pixels from the ratio: the split stays proportional instead
      // of sticking to a pixel offset that no longer means the same thing.
      this._applyRatio();
    };

    mapB.on('resize', this._onResize);

    if (options.mousemove) {
      mapA.getContainer().addEventListener('mousemove', this._onMove);
      mapB.getContainer().addEventListener('mousemove', this._onMove);
    }

    this._swiper.addEventListener('mousedown', this._onDown);
    this._swiper.addEventListener('touchstart', this._onDown);

    // Keep both maps interactive, and stack them at the same z-index so
    // neither sits above the other
    this._styleContainer(mapA);
    this._styleContainer(mapB);
  }

  private get _extent(): number {
    return this._horizontal ? this._bounds.height : this._bounds.width;
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

  private _applyRatio(): void {
    this._setPosition(this._ratio * this._extent);
  }

  private _setPosition(x: number) {
    const extent = this._extent;
    // Once the divider reaches the minimum it pins there and cannot be dragged
    // further that way.
    const position = Math.min(
      Math.max(x, extent * this._minRatio),
      extent * (1 - this._minRatio)
    );

    this._controlContainer.style.transform = this._horizontal
      ? `translate(0, ${position.toString()}px)`
      : `translate(${position.toString()}px, 0)`;

    // Clip each map's visible area with clipPath to create the split effect
    const clipPathA = this._horizontal
      ? `inset(0 0 ${(this._bounds.height - position).toString()}px 0)`
      : `inset(0 ${(this._bounds.width - position).toString()}px 0 0)`;
    const clipPathB = this._horizontal
      ? `inset(${position.toString()}px 0 0 0)`
      : `inset(0 0 0 ${position.toString()}px)`;

    this._mapA.getContainer().style.clipPath = clipPathA;
    this._mapB.getContainer().style.clipPath = clipPathB;

    this.currentPosition = position;
    // A zero extent carries no ratio information, so keep the previous one
    if (extent > 0) {
      this._ratio = position / extent;
    }
  }

  // Pointer offset along the split axis, relative to the map container.
  // Not clamped here — _setPosition applies the authoritative bounds.
  private _getPosition(e: MouseEvent | TouchEvent): number {
    const point = this._getPoint(e);
    return this._horizontal
      ? point.clientY - this._bounds.top
      : point.clientX - this._bounds.left;
  }

  private _getPoint(e: MouseEvent | TouchEvent): MouseEvent | Touch {
    // `instanceof TouchEvent` throws a ReferenceError in browsers without a
    // global TouchEvent (desktop Safari, Firefox with touch disabled), which
    // breaks mouse dragging too. Detect by the `touches` property instead.
    return 'touches' in e ? e.touches[0] : e;
  }

  private _handleDown(e: MouseEvent | TouchEvent): void {
    e.preventDefault();
    if ('touches' in e) {
      document.addEventListener('touchmove', this._onMove);
      document.addEventListener('touchend', this._onEnd);
    } else {
      document.addEventListener('mousemove', this._onMove);
      document.addEventListener('mouseup', this._onEnd);
    }
  }

  private _handleMove(e: MouseEvent | TouchEvent): void {
    this._setPosition(this._getPosition(e));
  }

  // Drops the document-level drag listeners. Removing all four unconditionally
  // is a no-op for the ones that were never attached.
  private _stopDrag(): void {
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('mouseup', this._onEnd);
    document.removeEventListener('touchmove', this._onMove);
    document.removeEventListener('touchend', this._onEnd);
  }

  private _handleEnd(): void {
    this._stopDrag();
    this.fire('slideend', { currentPosition: this.currentPosition ?? 0 });
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

    this._swiper.removeEventListener('mousedown', this._onDown);
    this._swiper.removeEventListener('touchstart', this._onDown);
    // If remove() runs mid-drag (e.g. a route change while the handle is held),
    // the document listeners would survive and run _handleMove against a
    // removed map on the next pointer move, throwing and leaking.
    this._stopDrag();
    this._controlContainer.remove();
  }
}
