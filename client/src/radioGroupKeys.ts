import type { KeyboardEvent } from 'react';

/**
 * WAI-ARIA radiogroup keyboard support.
 *
 * A container marked `role="radiogroup"` is announced to assistive technology
 * as a single tab stop with arrow-key navigation, so the buttons inside it must
 * actually behave that way. Without this the group can be reached by Tab but
 * the selection can never be changed from the keyboard.
 *
 * Returns an `onKeyDown` handler for each `role="radio"` button in the group:
 * Arrow keys move the selection (wrapping), Home/End jump to the ends, and
 * focus follows the selection so the roving `tabIndex` lands on the new radio.
 */
export function radioGroupKeys<T>(options: readonly T[], current: T, onSelect: (next: T) => void) {
  return (event: KeyboardEvent<HTMLButtonElement>): void => {
    const index = options.indexOf(current);
    if (index < 0) return;

    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + options.length) % options.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = options.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    onSelect(options[nextIndex]);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[nextIndex]?.focus();
  };
}
