/**
 * Type definitions for the Compare utility.
 */

/** Comparison orientation (vertical: split left/right, horizontal: split top/bottom) */
export type CompareOrientation = 'vertical' | 'horizontal';

/** Compare options */
export interface CompareOptions {
  orientation?: CompareOrientation;
  mousemove?: boolean;
}

/** Compare event type */
export type CompareEventType = 'slideend';

/** Slide-end event */
export interface SlideEndEvent {
  currentPosition: number;
}
