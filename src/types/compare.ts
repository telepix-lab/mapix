/**
 * Type definitions for the Compare utility.
 */

/** Comparison orientation (vertical: split left/right, horizontal: split top/bottom) */
export type CompareOrientation = 'vertical' | 'horizontal';

/**
 * How far the divider may travel, as ratios (0–1) of the container extent
 * measured from its start edge (left for a vertical split, top for a
 * horizontal one).
 *
 * Unlike {@link CompareOptions.minRatio} the two ends are independent, so a
 * layout obstructed on one side only can express its range. Values outside
 * 0–1 are clamped, and a `max` below `min` pins the divider at `min`.
 */
export interface CompareBounds {
  /** Nearest the divider may come to the start edge. Defaults to 0. */
  min?: number;
  /** Farthest it may travel toward the end edge. Defaults to 1. */
  max?: number;
}

/** Compare options */
export interface CompareOptions {
  orientation?: CompareOrientation;
  mousemove?: boolean;
  /**
   * Minimum ratio (0–0.5) the divider must keep from each end. For example
   * `0.2` always reserves at least 20% for each side, and the divider cannot
   * be pushed past that. Defaults to 0 (the divider can travel to either end).
   *
   * Shorthand for `bounds: { min: r, max: 1 - r }`; ignored when
   * {@link CompareOptions.bounds} is given.
   */
  minRatio?: number;
  /**
   * Travel limits for the divider. Supersedes {@link CompareOptions.minRatio}
   * and can be asymmetric.
   */
  bounds?: CompareBounds;
  /**
   * Accessible name for the divider handle, used as its `aria-label`. Defaults
   * to an English string; supply the app's own wording when it is localized.
   */
  handleLabel?: string;
  /**
   * How far one arrow key moves the divider, as a ratio (0–1) of the container
   * extent. Defaults to 0.02 (2%). `PageUp` / `PageDown` move five times this.
   */
  keyboardStep?: number;
  /**
   * Where the divider starts, as a ratio (0–1) of the container extent.
   * Defaults to 0.5 and is clamped to the configured bounds.
   *
   * Set this rather than calling `setPosition` after construction: the
   * constructor is the one moment the container has just been measured, so the
   * divider lands in place instead of appearing at the centre for a frame.
   */
  initialRatio?: number;
}

/** Compare event type */
export type CompareEventType = 'slideend';

/** Slide-end event */
export interface SlideEndEvent {
  currentPosition: number;
}
