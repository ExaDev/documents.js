// The math-font and embedded-font object emission, split from writePdf: the used-glyph collection, the math font five-object group, and the embedded-face five-object groups, each pushing into the objects sink with the allocations writePdf reserved.
import type { PositionedFormula } from "document-schema.js";
import { collectUsedGlyphs } from "./math-content-write";
import { loadMathFont } from "./math-font";
import { subsetSfnt } from "./sfnt-subset";
import type { EmbeddedFace } from "./embedded-font";
import type { PdfObject } from "./objects";
import { pdfRef } from "./objects";
import { buildMathFontObjects } from "./math-font-write";
import { buildEmbeddedFontObjects } from "./embedded-font-write";
import { collectEmbeddedGlyphs } from "./embedded-font";

export interface FontObjectEmitState {
  readonly objects: { num: number; value: PdfObject }[];
  readonly formulas: readonly PositionedFormula[];
  readonly mathFontAlloc:
    | {
        type0Num: number;
        cidFontNum: number;
        descriptorNum: number;
        fontFileNum: number;
        toUnicodeNum: number;
      }
    | undefined;
  readonly embeddedAllocs: Iterable<
    [
      EmbeddedFace,
      {
        type0Num: number;
        cidFontNum: number;
        descriptorNum: number;
        fontFileNum: number;
        toUnicodeNum: number;
        texts: readonly string[];
        resourceName: string;
        codePoints: ReadonlySet<number>;
      },
    ]
  >;
  readonly compress: boolean;
}

export function emitFontObjects(
  state: FontObjectEmitState,
): { font: ReturnType<typeof loadMathFont> } | undefined {
  const { objects, formulas, mathFontAlloc, embeddedAllocs, compress } = state;

  const mathFont = mathFontAlloc === undefined ? undefined : loadMathFont();
  const usedGlyphs =
    mathFontAlloc === undefined || mathFont === undefined
      ? undefined
      : collectUsedGlyphs(formulas, mathFont.font);
  if (
    mathFontAlloc !== undefined &&
    mathFont !== undefined &&
    usedGlyphs !== undefined
  ) {
    const built = buildMathFontObjects(
      mathFont.font,
      usedGlyphs,
      {
        cidFontRef: pdfRef(mathFontAlloc.cidFontNum, 0),
        descriptorRef: pdfRef(mathFontAlloc.descriptorNum, 0),
        fontFileRef: pdfRef(mathFontAlloc.fontFileNum, 0),
        toUnicodeRef: pdfRef(mathFontAlloc.toUnicodeNum, 0),
      },
      compress,
    );
    objects.push({ num: mathFontAlloc.type0Num, value: built.type0 });
    objects.push({ num: mathFontAlloc.cidFontNum, value: built.cidFont });
    objects.push({ num: mathFontAlloc.descriptorNum, value: built.descriptor });
    objects.push({ num: mathFontAlloc.fontFileNum, value: built.fontFile });
    objects.push({ num: mathFontAlloc.toUnicodeNum, value: built.toUnicode });
  }

  for (const [face, alloc] of embeddedAllocs) {
    // The shaped glyph map is computed before the subset because its keys are the subset's own extra input: a 'GSUB' ligature glyph is reachable through no single code point's 'cmap' entry, so handing only the text's code points to the subsetter would drop exactly the ligature outlines the content stream is about to draw.
    const faceUsedGlyphs = collectEmbeddedGlyphs(alloc.texts, face);
    // Neither list needs sorting on the way in: subsetSfnt reduces both to one glyph set and
    // sorts that itself, so the subset (and its CRC32 tag) is the same whatever order the
    // document happened to encounter its text in.
    const subset = subsetSfnt(
      face.font,
      [...alloc.codePoints],
      [...faceUsedGlyphs.keys()],
    );
    if (subset === undefined) {
      // Loud rather than a silent fall-back to a standard-14 substitute: the caller's own registry chose this face, and quietly drawing the document in a different font than it asked for — with metrics already laid out against this one — would be a worse outcome than a failure naming exactly which face could not be embedded. subsetSfnt returns undefined only for a font it cannot rebuild correctly (a CFF-outline face with no 'glyf' at all, or a missing/truncated table it must reconstruct); see its own module comment.
      throw new Error(
        `font "${face.postScriptName}" resolved to an embeddable face, but its glyph outlines could not be subsetted — only TrueType-outline ('glyf') fonts can be embedded, so supply a TrueType face for this family or drop it from the registry`,
      );
    }
    const built = buildEmbeddedFontObjects(
      face,
      subset,
      faceUsedGlyphs,
      {
        cidFontRef: pdfRef(alloc.cidFontNum, 0),
        descriptorRef: pdfRef(alloc.descriptorNum, 0),
        fontFileRef: pdfRef(alloc.fontFileNum, 0),
        toUnicodeRef: pdfRef(alloc.toUnicodeNum, 0),
      },
      compress,
    );
    objects.push({ num: alloc.type0Num, value: built.type0 });
    objects.push({ num: alloc.cidFontNum, value: built.cidFont });
    objects.push({ num: alloc.descriptorNum, value: built.descriptor });
    objects.push({ num: alloc.fontFileNum, value: built.fontFile });
    objects.push({ num: alloc.toUnicodeNum, value: built.toUnicode });
  }
  return mathFont === undefined ? undefined : { font: mathFont };
}
