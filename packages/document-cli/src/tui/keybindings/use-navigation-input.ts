import { useInput } from 'ink';
import { useState } from 'react';

// A page jump moves a fixed number of rows rather than one viewport, because this hook knows the item count but not how many rows the calling screen actually renders -- that is ListView's business, and threading it back here would couple the two for no behavioural gain.
const PAGE_JUMP_ROWS = 10;

export interface NavigationInputOptions {
  readonly itemCount: number;
  readonly onSelect: (index: number) => void;
  readonly onBack: () => void;
  readonly onAppend?: () => void;
  // Ink's own `useInput` option name: `false` suspends this hook's key handling entirely, which is how a screen stops reacting while an overlay or a focused text field owns the keyboard.
  readonly isActive: boolean;
}

// Selection is clamped at both ends rather than wrapping around: in a document editor a list is usually long and positional (paragraph 1, paragraph 200), so wrapping from the last item to the first reads as a jump to somewhere unrelated rather than as a convenience.
export function useNavigationInput(options: NavigationInputOptions): { readonly selectedIndex: number } {
  const [rawIndex, setRawIndex] = useState(0);
  const lastIndex = Math.max(0, options.itemCount - 1);
  const clamp = (index: number): number => Math.min(Math.max(index, 0), lastIndex);
  const selectedIndex = clamp(rawIndex);

  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') {
        setRawIndex(clamp(selectedIndex - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setRawIndex(clamp(selectedIndex + 1));
        return;
      }
      if (key.pageUp) {
        setRawIndex(clamp(selectedIndex - PAGE_JUMP_ROWS));
        return;
      }
      if (key.pageDown) {
        setRawIndex(clamp(selectedIndex + PAGE_JUMP_ROWS));
        return;
      }
      if (key.home) {
        setRawIndex(0);
        return;
      }
      if (key.end) {
        setRawIndex(lastIndex);
        return;
      }
      if (key.escape || key.leftArrow || input === 'h') {
        options.onBack();
        return;
      }
      if (key.return || key.rightArrow || input === 'l') {
        if (options.itemCount > 0) {
          options.onSelect(selectedIndex);
        }
        return;
      }
      if (input === 'a') {
        options.onAppend?.();
      }
    },
    { isActive: options.isActive },
  );

  return { selectedIndex };
}
