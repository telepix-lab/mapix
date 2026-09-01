import type { CompareOrientation } from '../types';

/** PageUp / PageDown cover this many arrow presses. */
const PAGE_MULTIPLIER = 5;

/** Everything this module writes on the handle, and drops again on destroy. */
const MANAGED_ATTRIBUTES = [
  'role',
  'tabindex',
  'aria-label',
  'aria-orientation',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuenow',
] as const;

export interface HandleAccessibilityOptions {
  /** The handle element Compare created. */
  element: HTMLElement;
  /** Split orientation in Compare's sense: `vertical` splits left/right. */
  orientation: CompareOrientation;
  /** Accessible name for the handle. */
  label: string;
  /** Arrow-key increment, as a ratio of the container extent. */
  step: number;
  /** Travel limits as ratios, the same ones Compare clamps positions to. */
  limits: { min: number; max: number };
  /** The divider's starting ratio, published as the first `aria-valuenow`. */
  ratio: number;
  /**
   * Moves the divider to an absolute ratio. Compare clamps it, and reports
   * whether the divider actually moved.
   */
  moveTo: (ratio: number) => boolean;
  /** Moves the divider by a ratio delta, reporting movement like `moveTo`. */
  moveBy: (delta: number) => boolean;
  /** A keyboard gesture ended, so Compare can report it. */
  onCommit: () => void;
}

export interface HandleAccessibility {
  /** Republishes `aria-valuenow` after the divider moves, whatever moved it. */
  update: (ratio: number) => void;
  /** Drops the listeners and attributes this added. */
  destroy: () => void;
}

/** Ratios read better as whole percentages. */
const percent = (ratio: number): string => Math.round(ratio * 100).toString();

/**
 * How far a key moves the divider, or null when the key is not ours.
 *
 * Arrows move the divider the way they point: Left / Up toward the container's
 * start edge, Right / Down toward the end. One rule that holds in either
 * orientation, where ARIA's canonical "Up increases the value" would send a
 * top/bottom divider up the screen while its position grows downward.
 */
const keyDelta = (key: string, step: number): number | null => {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return -step;
    case 'ArrowRight':
    case 'ArrowDown':
      return step;
    case 'PageUp':
      return -step * PAGE_MULTIPLIER;
    case 'PageDown':
      return step * PAGE_MULTIPLIER;
    default:
      return null;
  }
};

/** Whether this module acts on a key, and so owns its release. */
const isHandledKey = (key: string): boolean =>
  key === 'Home' || key === 'End' || keyDelta(key, 1) !== null;

/**
 * Makes Compare's divider handle operable from the keyboard and legible to
 * assistive technology.
 *
 * This belongs to the library because Compare creates and owns the element: a
 * consumer adding keyboard support itself would have to dig the handle back out
 * of the DOM by an internal class name, coupling to a name mapix is otherwise
 * free to rename, and every consumer would repeat the same work.
 */
export const attachHandleAccessibility = ({
  element,
  orientation,
  label,
  step,
  limits,
  ratio,
  moveTo,
  moveBy,
  onCommit,
}: HandleAccessibilityOptions): HandleAccessibility => {
  // Whether this gesture has actually moved the divider. Taken from what
  // Compare reports rather than from the keypress, so arrowing on against a
  // limit does not report a gesture that changed nothing.
  let moved = false;

  // A held arrow repeats at the OS rate, and reporting each repeat would turn
  // one gesture into a burst of events. Committing on release ends the keyboard
  // path the way the drag path ends: once, when the user lets go.
  const commit = (): void => {
    if (!moved) return;
    moved = false;
    onCommit();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    // Leave the browser's own chords alone, history navigation among them.
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const delta = keyDelta(event.key, step);
    if (delta !== null) {
      event.preventDefault();
      if (moveBy(delta)) moved = true;
      return;
    }

    if (event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (moveTo(event.key === 'Home' ? limits.min : limits.max)) moved = true;
  };

  // Only our own keys end a gesture. Committing on any release would fire
  // mid-gesture when a modifier is tapped while an arrow is held, and fire
  // again when a Tab away and back lands its release here.
  const handleKeyUp = (event: KeyboardEvent): void => {
    if (!isHandledKey(event.key)) return;
    commit();
  };

  // Focus leaving ends the gesture too. Dropping the pending move instead would
  // lose the report for a gesture the user really made.
  const handleBlur = (): void => {
    commit();
  };

  // Compare writes a position on every frame of a drag, and percent() collapses
  // the whole travel to at most 101 strings. Without this guard, assistive
  // technology is told the value changed dozens of times a second while the
  // announced value has not changed at all.
  let published = '';
  const update = (next: number): void => {
    // aria-valuenow has to stay inside the advertised range. Compare already
    // clamps, so this only matters while the container reports a zero extent
    // and no position has been applied yet.
    const bounded = Math.min(Math.max(next, limits.min), limits.max);
    const value = percent(bounded);
    if (value === published) return;
    published = value;
    element.setAttribute('aria-valuenow', value);
  };

  element.setAttribute('role', 'slider');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', label);
  // ARIA names the axis the handle travels, which is the opposite of the split
  // it draws: a `vertical` split is a vertical line sliding left and right,
  // that is, a horizontal slider.
  element.setAttribute(
    'aria-orientation',
    orientation === 'vertical' ? 'horizontal' : 'vertical'
  );
  element.setAttribute('aria-valuemin', percent(limits.min));
  element.setAttribute('aria-valuemax', percent(limits.max));
  update(ratio);

  element.addEventListener('keydown', handleKeyDown);
  element.addEventListener('keyup', handleKeyUp);
  element.addEventListener('blur', handleBlur);

  return {
    update,
    destroy: () => {
      element.removeEventListener('keydown', handleKeyDown);
      element.removeEventListener('keyup', handleKeyUp);
      element.removeEventListener('blur', handleBlur);
      for (const attribute of MANAGED_ATTRIBUTES) {
        element.removeAttribute(attribute);
      }
    },
  };
};
