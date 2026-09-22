// A structural-validity check for minted RTF: every group opens and closes exactly once, so a writer that mints an open half of some construct without its matching close (or the reverse) leaves the brace count itself unbalanced, corrupting every group nested after the mistake. A per-construct substring assertion (`expect(out).toContain(...)`) cannot catch this class of defect on its own — it was exactly this gap that let writeFormFieldBoundaries's unconditional close loop ship an unbalanced "}}" for every degraded contentControl extent.
//
// Distinguishes a genuine `{`/`}` group delimiter from the same character escaped as literal text: escapeText in write.ts always spells a literal brace as `\{`/`\}`, and a literal backslash as `\\`, so any `{`/`}` not immediately following one of those two-character escapes is a real delimiter.

import { expect } from "vitest";

function countGroupBraces(rtf: string): {
  readonly open: number;
  readonly close: number;
} {
  let open = 0;
  let close = 0;
  // One pass, matching either a two-character escape (\\, \{, \}) or a single real brace, left to right and non-overlapping — exactly what a character-by-character scan tracking "am I mid-escape" would do, since RTF's escapes are never longer than two characters. Only the second alternative's own match is ever compared against "{"/"}"; a matched escape pair is a two-character string that can never equal either, so it is correctly skipped without needing its own branch.
  for (const [token] of rtf.matchAll(/\\[\\{}]|[{}]/g)) {
    if (token === "{") {
      open += 1;
    } else if (token === "}") {
      close += 1;
    }
  }
  return { open, close };
}

export function expectBalancedBraces(rtf: string): void {
  const { open, close } = countGroupBraces(rtf);
  expect(close, "unbalanced RTF braces in minted output").toBe(open);
}
