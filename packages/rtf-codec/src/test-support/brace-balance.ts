// A structural-validity check for minted RTF: every group opens and closes exactly once, so a writer that mints an open half of some construct without its matching close (or the reverse) leaves the brace count itself unbalanced, corrupting every group nested after the mistake. A per-construct substring assertion (`expect(out).toContain(...)`) cannot catch this class of defect on its own -- it was exactly this gap that let writeFormFieldBoundaries's unconditional close loop ship an unbalanced "}}" for every degraded contentControl extent.
//
// Distinguishes a genuine `{`/`}` group delimiter from the same character escaped as literal text: escapeText in write.ts always spells a literal brace as `\{`/`\}`, and a literal backslash as `\\`, so any `{`/`}` not immediately following one of those two-character escapes is a real delimiter.

import { expect } from "vitest";

function countGroupBraces(rtf: string): {
  readonly open: number;
  readonly close: number;
} {
  // Stripping every two-character escape (\\, \{, \}) first, left to right, non-overlapping, is exactly what a character-by-character scan tracking "am I mid-escape" would do -- RTF's escapes are never longer than two characters, so there is no case a greedy global regex consumes differently. What remains is real, unescaped `{`/`}` delimiters (and any untouched backslash-word sequences, e.g. \b, whose own trailing characters are never brace characters), so counting them by splitting is exact.
  const withoutEscapes = rtf.replace(/\\[\\{}]/g, "");
  return {
    open: withoutEscapes.split("{").length - 1,
    close: withoutEscapes.split("}").length - 1,
  };
}

export function expectBalancedBraces(rtf: string): void {
  const { open, close } = countGroupBraces(rtf);
  expect(close, "unbalanced RTF braces in minted output").toBe(open);
}
