/**
 * Type definitions for the Compare utility.
 */

/** Comparison orientation (vertical: split left/right, horizontal: split top/bottom) */
export type CompareOrientation = 'vertical' | 'horizontal';

/** Compare options */
export interface CompareOptions {
  orientation?: CompareOrientation;
  mousemove?: boolean;
  /**
   * Minimum ratio (0–0.5) the divider must keep from each end. For example
   * `0.2` always reserves at least 20% for each side, and the divider cannot
   * be pushed past that. Defaults to 0 (the divider can travel to either end).
   */
  minRatio?: number;
}

/** Compare event type */
export type CompareEventType = 'slideend';

/** Slide-end event */
export interface SlideEndEvent {
  currentPosition: number;
}
