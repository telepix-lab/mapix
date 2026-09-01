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
  /** Moves the divider to an absolute ratio. Compare clamps it. */
  moveTo: (ratio: number) => void;
  /** Moves the divider by a ratio delta. Compare clamps it. */
  moveBy: (delta: number) => void;
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
  // Whether the divider has moved since the last key release. A held arrow
  // repeats at the OS rate, and reporting each repeat would turn one gesture
  // into a burst of events; this way the keyboard path ends the way the drag
  // path does, once, when the user lets go.
  let moved = false;

  const handleKeyDown = (event: KeyboardEvent): void => {
    // Leave the browser's own chords alone, history navigation among them.
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const delta = keyDelta(event.key, step);
    if (delta !== null) {
      event.preventDefault();
      moveBy(delta);
      moved = true;
      return;
    }

    if (event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    moveTo(event.key === 'Home' ? limits.min : limits.max);
    moved = true;
  };

  const handleKeyUp = (): void => {
    if (!moved) return;
    moved = false;
    onCommit();
  };

  const update = (next: number): void => {
    // aria-valuenow has to stay inside the advertised range. Compare already
    // clamps, so this only matters while the container reports a zero extent
    // and no position has been applied yet.
    const bounded = Math.min(Math.max(next, limits.min), limits.max);
    element.setAttribute('aria-valuenow', percent(bounded));
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

  return {
    update,
    destroy: () => {
      element.removeEventListener('keydown', handleKeyDown);
      element.removeEventListener('keyup', handleKeyUp);
      for (const attribute of MANAGED_ATTRIBUTES) {
        element.removeAttribute(attribute);
      }
    },
  };
};
