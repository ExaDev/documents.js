// The outline emission, split from writePdf: the recursive pre-order item walk consuming the reserved item numbers through one shared cursor, and the /Outlines root object.
import type { LayoutDocument, LayoutOutlineItem } from "./layout";
import type { PdfObject } from "./objects";
import {
  pdfArray,
  pdfDict,
  pdfLiteralString,
  pdfName,
  pdfNum,
  pdfRef,
} from "./objects";
import { resolveDestinationArray } from "./write-annotations";

export interface OutlineEmitState {
  readonly objects: { num: number; value: PdfObject }[];
  readonly outlineItemNums: readonly number[];
  readonly outlineRootNum: number | undefined;
  readonly doc: LayoutDocument;
  readonly pageAllocs: readonly { pageNum: number }[];
}

export function emitOutlineObjects(state: OutlineEmitState): void {
  const { objects, outlineItemNums, outlineRootNum, doc, pageAllocs } = state;
  // outlineRootNum is allocated only for a non-empty outline, so it is the whole condition here: restating the emptiness check would duplicate the allocation-side guard.
  if (outlineRootNum !== undefined) {
    // One shared pre-order cursor across the whole walk: allocation reserved every item's number by pre-order count, so emission must consume them in exactly that order — a per-level cursor would hand children numbers already used by earlier siblings.
    let itemCursor = 0;
    const emitItems = (
      items: readonly LayoutOutlineItem[],
      parentNum: number,
    ): number[] => {
      const siblingNums: number[] = [];
      let prevNum: number | undefined;
      for (const item of items) {
        const ownNum = outlineItemNums[itemCursor]!;
        itemCursor += 1;
        siblingNums.push(ownNum);
        // Children are allocated contiguously AFTER this whole sibling run was pre-counted, so the recursive call consumes the remaining tail of the same pre-allocated run — the counts were reserved by the identical pre-order walk at allocation time, keeping object numbering deterministic.
        const childNums = emitItems(item.children, ownNum);
        const entries: [string, PdfObject][] = [
          ["Title", pdfLiteralString(new TextEncoder().encode(item.title))],
          ["Parent", pdfRef(parentNum, 0)],
        ];
        if (item.destination !== undefined) {
          entries.push([
            "Dest",
            pdfArray(
              resolveDestinationArray(
                doc,
                pageAllocs,
                item.destination,
                `outline item "${item.title}"`,
              ),
            ),
          ]);
        }
        if (prevNum !== undefined) {
          entries.push(["Prev", pdfRef(prevNum, 0)]);
        }
        if (siblingNums.length < items.length) {
          entries.push(["Next", pdfRef(outlineItemNums[itemCursor]!, 0)]);
        }
        if (childNums.length > 0) {
          entries.push(["First", pdfRef(childNums[0]!, 0)]);
          entries.push(["Last", pdfRef(childNums[childNums.length - 1]!, 0)]);
          // Every child is an open descendant: /Count states them all positively, the Acrobat-default outline state, so a reader re-presenting this document shows the tree expanded exactly as the LayoutDocument modelled it (the flat model has no "collapsed" fact to preserve).
          entries.push(["Count", pdfNum(childNums.length)]);
        }
        objects.push({
          num: ownNum,
          value: pdfDict(Object.fromEntries(entries)),
        });
        prevNum = ownNum;
      }
      return siblingNums;
    };
    const topLevelNums = emitItems(doc.outline ?? [], outlineRootNum);
    objects.push({
      num: outlineRootNum,
      value: pdfDict({
        Type: pdfName("Outlines"),
        First: pdfRef(topLevelNums[0]!, 0),
        Last: pdfRef(topLevelNums[topLevelNums.length - 1]!, 0),
      }),
    });
  }
}
