// A structural-validity check for minted RTF: every group opens and closes exactly once, so a writer that mints an open half of some construct without its matching close (or the reverse) leaves the brace count itself unbalanced, corrupting every group nested after the mistake. A per-construct substring assertion (`expect(out).toContain(...)`) cannot catch this class of defect on its own -- it was exactly this gap that let writeFormFieldBoundaries's unconditional close loop ship an unbalanced "}}" for every degraded contentControl extent.
//
// Distinguishes a genuine `{`/`}` group delimiter from the same character escaped as literal text: escapeText in write.ts always spells a literal brace as `\{`/`\}`, and a literal backslash as `\\`, so any `{`/`}` not immediately following one of those two-character escapes is a real delimiter.

import { expect } from "vitest";

export function countGroupBraces(rtf: string): {
  readonly open: number;
  readonly close: number;
} {
  let open = 0;
  let close = 0;
  let index = 0;
  while (index < rtf.length) {
    const character = rtf[index];
    if (character === "\\") {
      const next = rtf[index + 1];
      if (next === "\\" || next === "{" || next === "}") {
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (character === "{") {
      open += 1;
    } else if (character === "}") {
      close += 1;
    }
    index += 1;
  }
  return { open, close };
}

export function expectBalancedBraces(rtf: string): void {
  const { open, close } = countGroupBraces(rtf);
  expect(close, "unbalanced RTF braces in minted output").toBe(open);
}
