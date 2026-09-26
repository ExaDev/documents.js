// The tagged-structure /ParentTree emission, split from writePdf: one number-tree entry per marked page, each holding the owning-element references indexed by MCID, plus the /StructTreeRoot object pointing at both the element roots and the tree.
import type { PdfObject } from "./objects";
import { pdfArray, pdfDict, pdfName, pdfNull, pdfNum, pdfRef } from "./objects";

export interface StructParentTreeState {
  readonly objects: { num: number; value: PdfObject }[];
  readonly structElementNumById: ReadonlyMap<string, number>;
  readonly markedStructureByPage: ReadonlyMap<
    number,
    readonly { mcid: number; structureId: string }[]
  >;
  readonly structureRoots: readonly { id: string }[];
  readonly structRootNum: number | undefined;
  readonly structParentTreeNum: number | undefined;
}

export function emitStructParentTree(state: StructParentTreeState): void {
  const {
    objects,
    structElementNumById,
    markedStructureByPage,
    structureRoots,
    structRootNum,
    structParentTreeNum,
  } = state;
  // #967: the /ParentTree number tree. One entry per marked page, keyed by that page's /StructParents value, holding the array of owning element references indexed by MCID — exactly the association structure.ts's own reader walks back. An MCID with no owning element (an item marked for a layer only, or naming an element id this document's tree does not carry) files a null, the spelling a producer writes for an unused slot.
  if (structRootNum !== undefined && structParentTreeNum !== undefined) {
    const nums: PdfObject[] = [];
    for (const [pageIndex, marks] of markedStructureByPage) {
      // Each slot 0..maxMcid derives its own value — an owning element's reference, or null for an MCID no element claims — so the array's length is exactly maxMcid+1 by construction rather than by a post-hoc fill that a shorter allocation would silently repair.
      const maxMcid = Math.max(...marks.map((mark) => mark.mcid));
      const byMcid: PdfObject[] = Array.from(
        { length: maxMcid + 1 },
        (_, mcid) => {
          const mark = marks.find((candidate) => candidate.mcid === mcid);
          const elementNum =
            mark === undefined
              ? undefined
              : structElementNumById.get(mark.structureId);
          return elementNum === undefined ? pdfNull() : pdfRef(elementNum, 0);
        },
      );
      nums.push(pdfNum(pageIndex), pdfArray(byMcid));
    }
    objects.push({
      num: structParentTreeNum,
      value: pdfDict({ Nums: pdfArray(nums) }),
    });
    const rootEntries: [string, PdfObject][] = [
      ["Type", pdfName("StructTreeRoot")],
      [
        "K",
        pdfArray(
          structureRoots.map((element) => {
            const num = structElementNumById.get(element.id);
            if (num === undefined) {
              throw new Error(
                `structure element "${element.id}" was not allocated — this is a writePdf internal invariant violation`,
              );
            }
            return pdfRef(num, 0);
          }),
        ),
      ],
      ["ParentTree", pdfRef(structParentTreeNum, 0)],
    ];
    objects.push({
      num: structRootNum,
      value: pdfDict(Object.fromEntries(rootEntries)),
    });
  }
}
