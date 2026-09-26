// The page-object emission loop, split from writePdf: marked-content structure collection, per-formula page grouping, the ContentWriteContext (font and image resolvers against the allocation maps), and the per-page content write with optional-content marks, formula streams and widget annotations. Returns the marked-structure map the /ParentTree assembly consumes.
import type { LayoutFont, PositionedFormula } from "document-schema.js";
import type { WinAnsiSubstitution } from "./winansi";
import type { EmbeddedFaceSubstitution } from "./embedded-font";
import type { ContentWriteContext } from "./content-write";
import { writeContentStream } from "./content-write";
import { concatBytes } from "./bytes/writer";
import { deflate } from "./bytes/flate";
import type { EmbeddedFace } from "./embedded-font";
import type { FontRegistry } from "./font-registry";
import { resolveFaceWithRegistry } from "./font-registry";
import type { LayoutDocument } from "./layout";
import type { LoadedMathFont } from "./math-font";
import { writeFormulaContentStream } from "./math-content-write";
import { type createFontMeasurer } from "./measure";
import type { PdfObject } from "./objects";
import {
  pdfArray,
  pdfDict,
  pdfName,
  pdfNum,
  pdfRef,
  pdfStream,
} from "./objects";
import { throwIfAborted } from "./util/abort";
import {
  buildInternalLinkAnnotDict,
  buildLinkAnnotDict,
  buildNotesAnnotDict,
  isInternalLinkItem,
  isLinkItem,
} from "./write-annotations";

export interface PdfObjectSink {
  num: number;
  value: PdfObject;
}
export interface WritePdfPageOptions {
  readonly signal?: AbortSignal;
  readonly onSubstitution?: (
    substitution: WinAnsiSubstitution,
    context: { readonly pageIndex: number },
  ) => void;
  readonly onMissingGlyph?: (
    missing: EmbeddedFaceSubstitution,
    context: { readonly pageIndex: number },
  ) => void;
}
export interface PageEmitState {
  readonly doc: LayoutDocument;
  readonly options: WritePdfPageOptions;
  readonly objects: PdfObjectSink[];
  readonly compress: boolean;
  readonly measurer: ReturnType<typeof createFontMeasurer>;
  readonly registry: FontRegistry | undefined;
  readonly fontAllocs: ReadonlyMap<
    string,
    {
      resourceName: string;
      fontNum: number;
      descNum: number;
      objNum?: number;
      objNums?: readonly number[];
    }
  >;
  readonly embeddedAllocs: ReadonlyMap<EmbeddedFace, { resourceName: string }>;
  readonly imageAllocs: ReadonlyMap<
    string,
    { resourceName: string; [extra: string]: unknown }
  >;
  readonly layerNumByName: ReadonlyMap<string, number>;
  readonly formulas: readonly PositionedFormula[];
  readonly mathFontAlloc: { resourceName: string } | undefined;
  readonly mathFont: LoadedMathFont | undefined;
  readonly pageAllocs: readonly { pageNum: number; contentsNum: number }[];
  readonly pagesNum: number;
  readonly resourcesDict: PdfObject;
  readonly widgetAnnotsByPage: ReadonlyMap<number, PdfObject[]>;
}

export function emitPageObjects(
  s: PageEmitState,
): Map<number, { mcid: number; structureId: string }[]> {
  const {
    doc,
    options,
    objects,
    compress,
    measurer,
    registry,
    fontAllocs,
    embeddedAllocs,
    imageAllocs,
    layerNumByName,
    formulas,
    mathFontAlloc,
    mathFont,
    pageAllocs,
    pagesNum,
    resourcesDict,
    widgetAnnotsByPage,
  } = s;
  // #967: each page's (MCID -> owning element id) marks, filled by the content writer as it assigns MCIDs, consumed by the /ParentTree assembly after the walk.
  const markedStructureByPage = new Map<
    number,
    { mcid: number; structureId: string }[]
  >();

  const formulasByPage = new Map<number, PositionedFormula[]>();
  for (const formula of formulas) {
    const forPage = formulasByPage.get(formula.pageIndex);
    if (forPage === undefined) {
      formulasByPage.set(formula.pageIndex, [formula]);
    } else {
      forPage.push(formula);
    }
  }

  const context: ContentWriteContext = {
    measurer,
    resolveFont: (font: Readonly<LayoutFont>) => {
      const resolved = resolveFaceWithRegistry(registry, font);
      if (resolved.kind === "embedded") {
        const alloc = embeddedAllocs.get(resolved.face);
        if (alloc === undefined) {
          throw new Error(
            `embedded font "${resolved.face.postScriptName}" was not pre-allocated — this is a writePdf internal invariant violation`,
          );
        }
        return {
          kind: "embedded",
          resourceName: alloc.resourceName,
          face: resolved.face,
        };
      }
      const alloc = fontAllocs.get(resolved.standardName);
      if (alloc === undefined) {
        throw new Error(
          `font "${resolved.standardName}" was not pre-allocated — this is a writePdf internal invariant violation`,
        );
      }
      return {
        kind: "standard",
        resourceName: alloc.resourceName,
        standardName: resolved.standardName,
      };
    },
    resolveImage: (imageId) => {
      const alloc = imageAllocs.get(imageId);
      if (alloc === undefined) {
        throw new Error(
          `image "${imageId}" was not pre-allocated — this is a writePdf internal invariant violation`,
        );
      }
      return { resourceName: alloc.resourceName };
    },
  };

  doc.pages.forEach((page, pageIndex) => {
    throwIfAborted(options.signal);
    const { pageNum, contentsNum } = pageAllocs[pageIndex]!;

    // #967: the per-page marked-content state. MCIDs are page-scoped and sequential in emission order; the layer object numbers were allocated up front, so the content writer can spell an item's /OC reference inline.
    let pageMcid = 0;
    const pageContext: ContentWriteContext = {
      ...context,
      nextMcid: () => pageMcid++,
      layerObjectNumberOf: (name: string) => layerNumByName.get(name),
    };
    const {
      bytes: contentBytes,
      substitutions,
      missingGlyphs,
      markedStructure,
    } = writeContentStream(page.items, pageContext);
    if (markedStructure.length > 0) {
      // Registered only when non-empty, so a page's presence in the register below means it genuinely has marked items.
      markedStructureByPage.set(pageIndex, [...markedStructure]);
    }
    for (const substitution of substitutions) {
      options.onSubstitution?.(substitution, { pageIndex });
    }
    for (const missing of missingGlyphs) {
      options.onMissingGlyph?.(missing, { pageIndex });
    }

    const pageFormulas = formulasByPage.get(pageIndex);
    const formulaBytes =
      pageFormulas === undefined ||
      mathFontAlloc === undefined ||
      mathFont === undefined
        ? undefined
        : writeFormulaContentStream(pageFormulas, {
            font: mathFont.font,
            resourceName: mathFontAlloc.resourceName,
          });
    const combinedContentBytes =
      formulaBytes === undefined
        ? contentBytes
        : concatBytes([contentBytes, formulaBytes]);

    const finalContentBytes = compress
      ? deflate(combinedContentBytes)
      : combinedContentBytes;
    const contentsDict = pdfDict(
      compress ? { Filter: pdfName("FlateDecode") } : {},
    );
    objects.push({
      num: contentsNum,
      value: pdfStream(contentsDict, finalContentBytes),
    });

    const annots = [
      ...page.items.filter(isLinkItem).map((link) => buildLinkAnnotDict(link)),
      ...page.items
        .filter(isInternalLinkItem)
        .map((link) => buildInternalLinkAnnotDict(link, doc, pageAllocs)),
    ];
    if (page.notes !== undefined && page.notes.length > 0) {
      annots.push(buildNotesAnnotDict(page.notes));
    }
    // The page's form-field widgets, in field order: riding /Annots alongside the links and notes so a viewer that never walks the AcroForm tree still renders them. These are references to the very objects the field tree owns, not copies — annotations.ts's own /Annots walk skips /Subtype /Widget for exactly this reason.
    annots.push(...(widgetAnnotsByPage.get(pageIndex) ?? []));

    const pageEntries = new Map<string, PdfObject>([
      ["Type", pdfName("Page")],
      ["Parent", pdfRef(pagesNum, 0)],
      [
        "MediaBox",
        pdfArray([0, 0, page.widthPt, page.heightPt].map((n) => pdfNum(n))),
      ],
      ["Resources", resourcesDict],
      ["Contents", pdfRef(contentsNum, 0)],
    ]);
    if (annots.length > 0) {
      pageEntries.set("Annots", pdfArray(annots));
    }
    if (markedStructureByPage.has(pageIndex)) {
      // The producer-chosen key this page's parent-tree entry is filed under (14.7.4.4); the page's own position is the natural deterministic choice for a writer minting the tree itself.
      pageEntries.set("StructParents", pdfNum(pageIndex));
    }
    objects.push({ num: pageNum, value: pdfDict(pageEntries) });
  });
  return markedStructureByPage;
}
