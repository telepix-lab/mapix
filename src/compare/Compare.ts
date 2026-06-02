import { Map } from 'mapbox-gl';
import type { CompareEventType, CompareOptions, SlideEndEvent } from '../types';
import { EventEmitter } from './event-emitter';
import { syncMove } from './sync-move';

type CompareContainer = string | HTMLElement;

export class Compare {
  private _mapA: Map;
  private _mapB: Map;
  private _swiper: HTMLElement;
  private _controlContainer: HTMLElement;
  private _bounds: DOMRect;
  private _horizontal: boolean;
  private _clearSync: () => void;
  private _onResize: () => void;
  private _ev: EventEmitter;
  private _onDown: (e: MouseEvent | TouchEvent) => void;
  private _onMove: (e: MouseEvent | TouchEvent) => void;
  private _onMouseUp: () => void;
  private _onTouchEnd: () => void;
  private currentPosition: number | null;
  private options: CompareOptions;

  constructor(
    mapA: Map,
    mapB: Map,
    container: CompareContainer,
    options: CompareOptions = {}
  ) {
    this.options = options;
    this._mapA = mapA;
    this._mapB = mapB;
    this._horizontal = options.orientation === 'horizontal';
    this._ev = new EventEmitter();
    this._onDown = this._handleDown.bind(this);
    this._onMove = this._handleMove.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onTouchEnd = this._handleTouchEnd.bind(this);
    this.currentPosition = null;

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

    this._bounds = mapB.getContainer().getBoundingClientRect();
    const initialPosition = this._horizontal
      ? this._bounds.height
      : this._bounds.width;
    this._setPosition(initialPosition / 2);

    this._clearSync = syncMove(mapA, mapB);
    this._onResize = () => {
      this._bounds = mapB.getContainer().getBoundingClientRect();
      if (this.currentPosition != null) {
        this._setPosition(this.currentPosition);
      }
    };

    mapB.on('resize', this._onResize);

    if (options.mousemove) {
      mapA.getContainer().addEventListener('mousemove', this._onMove);
      mapB.getContainer().addEventListener('mousemove', this._onMove);
    }

    this._swiper.addEventListener('mousedown', this._onDown);
    this._swiper.addEventListener('touchstart', this._onDown);

    // Initial styles so both maps stay interactive
    this._mapA.getContainer().style.pointerEvents = 'auto';
    this._mapB.getContainer().style.pointerEvents = 'auto';
    // Stack both maps at the same z-index so neither sits above the other
    this._mapA.getContainer().style.position = 'absolute';
    this._mapB.getContainer().style.position = 'absolute';
    this._mapA.getContainer().style.zIndex = '1';
    this._mapB.getContainer().style.zIndex = '1';
  }

  private _setPosition(x: number) {
    x = Math.min(
      x,
      this._horizontal ? this._bounds.height : this._bounds.width
    );
    const transform = this._horizontal
      ? `translate(0, ${x.toString()}px)`
      : `translate(${x.toString()}px, 0)`;

    this._controlContainer.style.transform = transform;

    // Clip each map's visible area with clipPath to create the split effect
    const clipPathA = this._horizontal
      ? `inset(0 0 ${(this._bounds.height - x).toString()}px 0)`
      : `inset(0 ${(this._bounds.width - x).toString()}px 0 0)`;
    const clipPathB = this._horizontal
      ? `inset(${x.toString()}px 0 0 0)`
      : `inset(0 0 0 ${x.toString()}px)`;

    this._mapA.getContainer().style.clipPath = clipPathA;
    this._mapB.getContainer().style.clipPath = clipPathB;

    this.currentPosition = x;
  }

  private _getX(e: MouseEvent | TouchEvent): number {
    const point = this._getPoint(e);
    const x = point.clientX - this._bounds.left;
    return Math.min(Math.max(x, 0), this._bounds.width);
  }

  private _getY(e: MouseEvent | TouchEvent): number {
    const point = this._getPoint(e);
    const y = point.clientY - this._bounds.top;
    return Math.min(Math.max(y, 0), this._bounds.height);
  }

  private _getPoint(e: MouseEvent | TouchEvent): MouseEvent | Touch {
    return e instanceof TouchEvent ? e.touches[0] : e;
  }

  private _handleDown(e: MouseEvent | TouchEvent): void {
    e.preventDefault();
    if (e instanceof TouchEvent) {
      document.addEventListener('touchmove', this._onMove);
      document.addEventListener('touchend', this._onTouchEnd);
    } else {
      document.addEventListener('mousemove', this._onMove);
      document.addEventListener('mouseup', this._onMouseUp);
    }
  }

  private _handleMove(e: MouseEvent | TouchEvent): void {
    const position = this._horizontal ? this._getY(e) : this._getX(e);
    this._setPosition(position);
  }

  private _handleMouseUp(): void {
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    this.fire('slideend', { currentPosition: this.currentPosition ?? 0 });
  }

  private _handleTouchEnd(): void {
    document.removeEventListener('touchmove', this._onMove);
    document.removeEventListener('touchend', this._onTouchEnd);
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

    // Reset clipping and styles
    this._mapA.getContainer().style.clipPath = '';
    this._mapB.getContainer().style.clipPath = '';
    this._mapA.getContainer().style.pointerEvents = '';
    this._mapB.getContainer().style.pointerEvents = '';
    this._mapA.getContainer().style.zIndex = '';
    this._mapB.getContainer().style.zIndex = '';

    this._swiper.removeEventListener('mousedown', this._onDown);
    this._swiper.removeEventListener('touchstart', this._onDown);
    this._controlContainer.remove();
  }
}
