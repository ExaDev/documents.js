import type { ContentBlock } from "document-schema.js";
import type { Fib } from "./fib/fib";
import { readSubdocumentStories } from "./subdocument";
import { assembleBlocks } from "./table/read";
import type { ReadContext } from "./text/paragraphs";
import type { PieceTable } from "./text/piece-table";

// Headers and footers, read as real block flow -- ooxml.js's own DocxDocument.headerFooterParts shape (typed/docx/read.ts's HeaderFooterPart: `{path, kind, blocks}`), adapted for a format with no named parts of its own: [MS-DOC]'s own Headers page states the header document is split into a FIXED sequence of stories by Plcfhdd -- six footnote/endnote separator stories (not modelled here: this reader carries no ContentDocument field for a separator, and neither does ooxml.js's own DocxDocument), then, per section in order, six more -- even header, odd header, even footer, odd footer, first-page header, first-page footer -- so a story's identity is its own (section index, slot) position rather than a path. An empty story ([MS-DOC]'s own "the beginning CP has the same value as the next CP") specifies "the header/footer of the corresponding type of the previous section is used" (or none, for the first section) rather than a genuinely blank header, so it is left out of the result entirely instead of being emitted as a hollow `{blocks: []}` entry a caller could misread as a deliberate blank one.

export type HeaderFooterSlot =
  | "evenHeader"
  | "oddHeader"
  | "evenFooter"
  | "oddFooter"
  | "firstHeader"
  | "firstFooter";

export interface HeaderFooterStory {
  /** The 0-based index into DocContent.sections this story belongs to. */
  readonly section: number;
  readonly slot: HeaderFooterSlot;
  readonly blocks: readonly ContentBlock[];
}

export type HeaderFooterStories = readonly HeaderFooterStory[];

/** The six per-section slots' own order within each of Plcfhdd's per-section groups, [MS-DOC]'s own Headers page: "The stories within each group MUST appear in the following order." Exported because subdocument-write.ts builds Plcfhdd in the identical order -- one source of it, so the two directions cannot drift. */
export const SLOT_ORDER: readonly HeaderFooterSlot[] = [
  "evenHeader",
  "oddHeader",
  "evenFooter",
  "oddFooter",
  "firstHeader",
  "firstFooter",
];

/** The six fixed footnote/endnote-separator stories preceding every section's own six -- footnote separator, footnote continuation separator, footnote continuation notice, endnote separator, endnote continuation separator, endnote continuation notice -- carried by Plcfhdd but not read here, since neither this package's own schema nor ooxml.js's DocxDocument has anywhere to put a separator story. Exported for subdocument-write.ts, which writes the same six slots as genuinely empty stories. */
export const FIXED_SEPARATOR_STORY_COUNT = 6;

export function readHeaderFooterStories(
  wordDocument: Uint8Array,
  table: Uint8Array,
  pieceTable: PieceTable,
  context: ReadContext,
  fib: Fib,
  sectionCount: number,
): HeaderFooterStories {
  // Subdocument order, [MS-DOC] 2.4.1: the header document begins immediately after the footnote document.
  const headerStartCp = fib.ccpText + fib.ccpFtn;
  const allStories = readSubdocumentStories(
    wordDocument,
    table,
    pieceTable,
    context,
    headerStartCp,
    fib.ccpHdd,
    fib.fcPlcfHdd,
    fib.lcbPlcfHdd,
    "Plcfhdd",
  );
  const perSectionStories = allStories.slice(FIXED_SEPARATOR_STORY_COUNT);

  const stories: HeaderFooterStory[] = [];
  for (let section = 0; section < sectionCount; section += 1) {
    // Iterated as [index, slot] pairs rather than a numeric slotIndex bounded by its own `< SLOT_ORDER.length` check: SLOT_ORDER is a fixed 6-element array, so that bound and this loop's own `slot === undefined` guard below it were two ways of expressing the identical fact, leaving the numeric comparison unable to ever diverge from the guard that already covers it.
    for (const [slotIndex, slot] of SLOT_ORDER.entries()) {
      const entries =
        perSectionStories[section * SLOT_ORDER.length + slotIndex];
      if (entries === undefined || entries.length === 0) continue;
      stories.push({ section, slot, blocks: assembleBlocks(entries) });
    }
  }
  return stories;
}
