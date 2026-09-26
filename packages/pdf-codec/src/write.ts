import { base64ToBytes } from "byte-codec";
import { deflate } from "./bytes/flate";
import { ByteWriter } from "./bytes/writer";
import { randomBytes } from "./crypto/random";
import type { PdfEncryptionOptions } from "./encrypt-write";
import {
  createStandardEncryptor,
  encryptIndirectObject,
} from "./encrypt-write";
import { prepareImage, type PreparedImage } from "./write-images";
import {
  type AllocatedObject,
  restoreResidueRow,
  xrefEntry,
} from "./write-annotations";
import { emitFormObjects } from "./write-form";
import { emitFontObjects } from "./write-font-objects";
import { emitPageObjects } from "./write-page-emit";
import { emitOutlineObjects } from "./write-outline";
import { buildInfoDict } from "./write-strings";
import type { PositionedFormula } from "document-schema.js";
import type {
  LayoutDocument,
  LayoutFormField,
  LayoutOutlineItem,
  LayoutStructureElement,
} from "./layout";
import type { FontMetrics, StandardFontName } from "./afm-widths";
import { STANDARD_METRICS, widthOfCode } from "./afm-widths";
import type { EmbeddedFace, EmbeddedFaceSubstitution } from "./embedded-font";
import type { FontRegistry } from "./font-registry";
import { resolveFaceWithRegistry } from "./font-registry";
import { createFontMeasurer } from "./measure";
import type { PdfDict, PdfObject } from "./objects";
import {
  pdfArray,
  pdfDict,
  pdfHexString,
  pdfName,
  pdfNull,
  pdfNum,
  pdfRef,
  pdfLiteralString,
  pdfStream,
} from "./objects";
import { writeObject } from "./serialize";
import type { WinAnsiSubstitution } from "./winansi";

// A formula's own glyph runs are shown through an embedded CID composite font via Identity-H 2-byte CIDs (see math-content-write.ts's own module comment) — a fundamentally different content-stream shape from an ordinary LayoutText item's single-byte WinAnsi string, and one this package's own LayoutItem union (src/layout.ts) has no member for (LayoutFont only ever names one of the 14 standard PDF faces — see document-schema.js's style.ts comment — with no room for "this run uses an embedded, non-standard font resource" at all). A formula therefore cannot travel through LayoutDocument.pages[].items the way every other kind of content this writer draws does; WritePdfOptions.formulas is this module's own, local side channel for it instead, positioned entirely outside the LayoutDocument schema itself.
const MATH_FONT_RESOURCE_NAME = "MF";

// The /Resources/Font key prefix for an embedded text face, deliberately distinct from both the standard-14 faces' own 'F' prefix and the math font's 'MF': all three share one /Font dict, so a collision would silently make one font's resource name resolve to another's object.
const EMBEDDED_FONT_RESOURCE_PREFIX = "E";

// WinAnsiEncoding's assigned byte range starts at 32 (space, the first printable ASCII code) and this writer's fonts use exactly the encoding's full byte range up to 255.
const FIRST_CHAR = 32;
const LAST_CHAR = 255;

// The PDF spec requires /StemV on every FontDescriptor, but for a non-embedded standard-14 font every conforming reader already has this exact face's real metrics built in and never consults this value to render it — these are nominal regular/bold values (heavier stroke weight for bold), included only to satisfy the spec's required-field rule.
const NOMINAL_STEM_V_REGULAR = 80;
const NOMINAL_STEM_V_BOLD = 120;

// FontDescriptor /Flags bit values (ISO 32000-1 Table 123).
const FLAG_FIXED_PITCH = 1;
const FLAG_SERIF = 2;
const FLAG_NONSYMBOLIC = 32;
const FLAG_ITALIC = 64;
const FLAG_FORCE_BOLD = 262144;

export interface WritePdfOptions {
  // Compresses content streams and PNG-sourced image data with FlateDecode. Defaults to true; false is an escape hatch for producing a human-auditable, uncompressed PDF (e.g. for a byte-golden test). JPEG-sourced images are embedded via DCTDecode regardless — this option never touches them.
  readonly compress?: boolean;
  readonly signal?: AbortSignal;
  // Called once per WinAnsi character substitution made while emitting text (see src/pdf/winansi.ts). writePdf itself has no Diagnostic schema to translate these into — a caller that wants diagnostics (e.g. the local DocumentConverter) supplies this and does the translation itself. Only ever raised for text drawn in a standard-14 face; an embedded face reports through onMissingGlyph below instead.
  readonly onSubstitution?: (
    substitution: WinAnsiSubstitution,
    context: { readonly pageIndex: number },
  ) => void;
  // Called once per character drawn as .notdef because the EMBEDDED face resolved for it (see `fonts`) has no glyph for that character. The embedded-face counterpart to onSubstitution, kept separate because nothing visible was substituted — see ContentStreamResult.missingGlyphs for why inventing a WinAnsiSubstitution's own `to` here would be a worse report than an honest one with no replacement to name.
  readonly onMissingGlyph?: (
    missing: EmbeddedFaceSubstitution,
    context: { readonly pageIndex: number },
  ) => void;
  // Resolves each text item's own LayoutFont to a real embeddable face where one is available, falling through to the standard-14 mapping otherwise (see src/font-registry.ts for the full five-step order). Omitted — the default — every font resolves through resolveStandardFont exactly as it always has, no font program is embedded, and output is byte-identical to a build with no embedded-font support at all: a registry only ever changes anything for a caller that explicitly constructs one.
  readonly fonts?: FontRegistry;
  // Every embedded formula to draw (src/mathml's own MathBox, already positioned per page) — see this module's own top-of-file comment for why a formula can't travel through doc.pages[].items itself. The embedded STIX Two Math composite font (one Type0/CIDFontType0/FontDescriptor/FontFile3/ToUnicode object group) is allocated once for the whole document, only when this array is non-empty, and shared across every page that references it — the same "allocate once, reuse via /Resources" pattern this writer already uses for every standard-14 font and image asset.
  readonly formulas?: readonly PositionedFormula[];
  // Encrypts the written PDF with the standard security handler under one of encrypt-write.ts's four schemes (default: aes-256). Omitted — the default — no /Encrypt dictionary is written at all and output is byte-identical to a build with no encryption support; see encrypt-write.ts's own module comment for the write-side algorithms and README.md's Gotchas section for this feature's scope.
  readonly encryption?: PdfEncryptionOptions;
}

// A PDF file identifier (trailer /ID) is only ever written when encryption is requested — an unencrypted document has never needed one from this writer, and adding it unconditionally would change every existing golden-byte test's output. 16 bytes matches the ID this writer's own qpdf-produced test fixtures carry (src/test-support/encrypted-pdfs.ts).
const FILE_ID_BYTES = 16;

// Shared byte-packing facts, used by the UTF-16BE string encoder, the PNG image writer, and the bilevel-to-CCITT bit packer below.

function computeFontFlags(
  standardName: StandardFontName,
  metrics: FontMetrics,
): number {
  let flags = FLAG_NONSYMBOLIC;
  if (standardName.startsWith("Courier")) {
    flags |= FLAG_FIXED_PITCH;
  }
  if (standardName.startsWith("Times")) {
    flags |= FLAG_SERIF;
  }
  if (metrics.italicAngle !== 0) {
    flags |= FLAG_ITALIC;
  }
  if (standardName.includes("Bold")) {
    flags |= FLAG_FORCE_BOLD;
  }
  return flags;
}

function buildFontObjects(
  standardName: StandardFontName,
  descriptorRef: PdfObject,
): { readonly font: PdfDict; readonly descriptor: PdfDict } {
  const metrics = STANDARD_METRICS[standardName];
  const widths: PdfObject[] = [];
  // The Widths array must cover FIRST_CHAR..LAST_CHAR without gaps. WINANSI_GLYPH_NAMES defines a glyph name for every one of those codes (the CP1252 positions with no real assignment are filled with a placeholder name like "bullet" rather than left empty — see encoding.ts's own comment), and every standard-14 AFM table carries a width for every name that table can produce, so widthOfCode never throws across this whole range for any of the 12 faces.
  for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
    widths.push(pdfNum(widthOfCode(standardName, code)));
  }
  const font = pdfDict({
    Type: pdfName("Font"),
    Subtype: pdfName("Type1"),
    BaseFont: pdfName(standardName),
    Encoding: pdfName("WinAnsiEncoding"),
    FirstChar: pdfNum(FIRST_CHAR),
    LastChar: pdfNum(LAST_CHAR),
    Widths: pdfArray(widths),
    FontDescriptor: descriptorRef,
  });
  const descriptor = pdfDict({
    Type: pdfName("FontDescriptor"),
    FontName: pdfName(standardName),
    Flags: pdfNum(computeFontFlags(standardName, metrics)),
    FontBBox: pdfArray(metrics.fontBBox.map((n) => pdfNum(n))),
    ItalicAngle: pdfNum(metrics.italicAngle),
    Ascent: pdfNum(metrics.ascender),
    Descent: pdfNum(metrics.descender),
    CapHeight: pdfNum(metrics.capHeight),
    XHeight: pdfNum(metrics.xHeight),
    StemV: pdfNum(
      standardName.includes("Bold")
        ? NOMINAL_STEM_V_BOLD
        : NOMINAL_STEM_V_REGULAR,
    ),
  });
  return { font, descriptor };
}

// Every Unicode code point the given texts carry, as a set — the subsetting input that must include even a character whose shaped glyph never appears (a ligature consumes its components' glyphs, so shaping alone under-covers the cmap).
function codePointsOf(texts: readonly string[]): Set<number> {
  return new Set(
    texts.flatMap((text) =>
      [...text].map((character) => character.codePointAt(0)!),
    ),
  );
}

// Assembles a LayoutDocument into a complete PDF file: the object graph (Catalog, Pages, Info, one Font+FontDescriptor pair per standard-14 face actually used, one Image XObject (+SMask) per image asset actually referenced, one embedded math composite font group when options.formulas is non-empty (Type0/CIDFontType0/FontDescriptor/FontFile3/ToUnicode — see math-font-write.ts), one embedded text font group per subsetted face when options.fonts resolved any (Type0/CIDFontType2/FontDescriptor/FontFile2/ToUnicode — see embedded-font-write.ts), then each page's own Page dict, Contents stream (ordinary LayoutItem bytes followed by that page's own formula bytes, if any — see math-content-write.ts), and optional Annots), a classic cross-reference table, and a trailer. Objects are allocated in this fixed order — never derived from Map/object iteration order — so identical input always produces byte-identical output (see the determinism tests).
//
// Without options.fonts, no embedded text face can exist, so that group consumes no object numbers and every other object is numbered exactly as it was before embedded-font support: output is byte-identical to a build with none of it (proved by the golden digests in write-embedded-font.test.ts).
export function writePdf(
  doc: LayoutDocument,
  options: WritePdfOptions = {},
): Uint8Array<ArrayBuffer> {
  const compress = options.compress ?? true;
  const registry = options.fonts;
  const measurer = createFontMeasurer(registry);
  // The measurer's own vertical-metric policy (see measure.ts's VerticalMetricPolicy) is deliberately not exposed as a WritePdfOptions field: nothing on this write path consults lineHeightAtSize/ascenderAtSize/descenderAtSize at all. Pagination and line breaking already happened in whichever layout engine produced this LayoutDocument, against its own measurer; the only measurements writePdf itself makes are horizontalScaleFor and (for a standard-14 face) underlineAtSize, neither of which the policy touches.

  let nextObjNum = 1;
  const catalogNum = nextObjNum++;
  const pagesNum = nextObjNum++;
  const infoNum = nextObjNum++;

  const fontNames = new Set<StandardFontName>();
  const imageIds = new Set<string>();
  // Keyed by the EmbeddedFace object itself rather than by family name: a FontRegistry memoises one face per (family, bold, italic), so two LayoutFonts that resolve to the same real font program (Calibri and Calibri Light both substituting to Carlito Regular, say) arrive here as the identical object and correctly share one embedded font group, while two genuinely different programs never collide however similarly they are named.
  const embeddedUses = new Map<EmbeddedFace, string[]>();
  for (const page of doc.pages) {
    for (const item of page.items) {
      if (item.kind === "text") {
        const resolved = resolveFaceWithRegistry(registry, item.font);
        if (resolved.kind === "embedded") {
          const texts = embeddedUses.get(resolved.face) ?? [];
          texts.push(item.text);
          embeddedUses.set(resolved.face, texts);
        } else {
          fontNames.add(resolved.standardName);
        }
      } else if (item.kind === "image") {
        imageIds.add(item.imageId);
      }
    }
  }

  const fontAllocs = new Map<
    StandardFontName,
    {
      readonly fontNum: number;
      readonly descNum: number;
      readonly resourceName: string;
    }
  >();
  for (const [index, name] of [...fontNames].sort().entries()) {
    const fontNum = nextObjNum++;
    const descNum = nextObjNum++;
    fontAllocs.set(name, { fontNum, descNum, resourceName: `F${index + 1}` });
  }

  const imageAllocs = new Map<
    string,
    {
      readonly imageNum: number;
      readonly smaskNum: number | undefined;
      readonly globalsNum: number | undefined;
      readonly globalsBase64: string | undefined;
      readonly resourceName: string;
      readonly prepared: PreparedImage;
    }
  >();
  for (const [index, imageId] of [...imageIds].sort().entries()) {
    const asset = doc.images[imageId];
    if (asset === undefined) {
      throw new Error(
        `LayoutDocument references image "${imageId}" but it is not present in images`,
      );
    }
    const prepared = prepareImage(asset, compress);
    const imageNum = nextObjNum++;
    const smaskNum = prepared.alpha === undefined ? undefined : nextObjNum++;
    const globalsBase64 =
      asset.original?.filter === "jbig2"
        ? asset.original.jbig2GlobalsBase64
        : undefined;
    const globalsNum = globalsBase64 !== undefined ? nextObjNum++ : undefined;
    imageAllocs.set(imageId, {
      imageNum,
      smaskNum,
      globalsNum,
      globalsBase64,
      resourceName: `Im${index + 1}`,
      prepared,
    });
  }

  const formulas = options.formulas ?? [];
  const mathFontAlloc =
    formulas.length === 0
      ? undefined
      : {
          type0Num: nextObjNum++,
          cidFontNum: nextObjNum++,
          descriptorNum: nextObjNum++,
          fontFileNum: nextObjNum++,
          toUnicodeNum: nextObjNum++,
          resourceName: MATH_FONT_RESOURCE_NAME,
        };

  // One five-object group per used embedded face, allocated in the same fixed order the math font's own group uses (Type0, descendant CIDFont, FontDescriptor, FontFile2, ToUnicode). Sorted by PostScript name so object numbering never depends on the order faces happened to be encountered in the page items; Array.prototype.sort is stable, so two distinct faces sharing one PostScript name keep first-encountered order and the ordering stays total. With no registry supplied this map is empty, no object number is consumed, and every allocation after this point is numbered exactly as it was before embedded fonts existed.
  const embeddedAllocs = new Map<
    EmbeddedFace,
    {
      readonly type0Num: number;
      readonly cidFontNum: number;
      readonly descriptorNum: number;
      readonly fontFileNum: number;
      readonly toUnicodeNum: number;
      readonly resourceName: string;
      readonly texts: readonly string[];
      readonly codePoints: ReadonlySet<number>;
    }
  >();
  const sortedEmbeddedUses = [...embeddedUses.entries()].sort(([a], [b]) =>
    a.postScriptName < b.postScriptName
      ? -1
      : a.postScriptName > b.postScriptName
        ? 1
        : 0,
  );
  for (const [index, [face, texts]] of sortedEmbeddedUses.entries()) {
    embeddedAllocs.set(face, {
      type0Num: nextObjNum++,
      cidFontNum: nextObjNum++,
      descriptorNum: nextObjNum++,
      fontFileNum: nextObjNum++,
      toUnicodeNum: nextObjNum++,
      resourceName: `${EMBEDDED_FONT_RESOURCE_PREFIX}${index + 1}`,
      texts,
      codePoints: codePointsOf(texts),
    });
  }

  const pageAllocs = doc.pages.map(() => ({
    pageNum: nextObjNum++,
    contentsNum: nextObjNum++,
  }));

  const encryptDictNum =
    options.encryption === undefined ? undefined : nextObjNum++;

  // #967: the read side's embedded-file attachments (#721) write back as a /Names /EmbeddedFiles tree — one /EmbeddedFile stream plus one /Filespec per attachment, the name-tree node listing them all, and a /Names entry on the Catalog. Allocation happens here, in document order, so the fixed-order determinism this writer is built around holds for attachments exactly as it does for fonts and images.
  const attachmentAllocs = (doc.attachments ?? []).map(() => ({
    fileNum: nextObjNum++,
    specNum: nextObjNum++,
  }));
  const attachmentsNamesNum =
    attachmentAllocs.length > 0 ? nextObjNum++ : undefined;

  // #967: the outline. One /Outlines root plus one item dict per bookmark node, allocated in the same pre-order walk that emits them, so sibling order and /Next chains are stable.
  const outlineRootNum =
    (doc.outline ?? []).length > 0 ? nextObjNum++ : undefined;
  const outlineItemNums: number[] = [];
  const countItems = (items: readonly LayoutOutlineItem[]): number => {
    let n = 0;
    for (const item of items) {
      n += 1 + countItems(item.children);
    }
    return n;
  };
  for (let i = 0; i < countItems(doc.outline ?? []); i += 1) {
    outlineItemNums.push(nextObjNum++);
  }

  // #967: optional-content layers. One OCG object per layer, in doc.layers order, so the /OCProperties lists stay stable under the fixed-order determinism rule.
  const layerNumByName = new Map<string, number>();
  for (const layer of doc.layers ?? []) {
    layerNumByName.set(layer.name, nextObjNum++);
  }

  // #967: the AcroForm field tree. One object per field (terminal or group); a terminal field with more than one widget spends one further object per WIDGET (each is a separate /Subtype /Widget kid and must be an indirect object of its own, because a page's /Annots array references the same annotation object the field's /Kids does — the spelling Acrobat's own files carry, per ISO 32000-1 12.5.1's rule that an annotation appears in the /Annots array of exactly the one page it is associated with). A single-widget field still merges the widget into the field dict itself — the merged-field/widget spelling the reader's own comment names — with that one dict serving as its page's /Annots entry.
  const formObjectNums: number[] = [];
  const countFieldObjects = (fields: readonly LayoutFormField[]): number => {
    let n = 0;
    for (const field of fields) {
      n +=
        1 +
        (field.fieldType !== "group" && field.widgets.length > 1
          ? field.widgets.length
          : 0) +
        countFieldObjects(field.children);
    }
    return n;
  };
  for (let i = 0; i < countFieldObjects(doc.form ?? []); i += 1) {
    formObjectNums.push(nextObjNum++);
  }
  const formNumByField = new Map<LayoutFormField, number>();
  const formExtraWidgetNums = new Map<LayoutFormField, number[]>();
  let formNumCursor = 0;
  const claimFormNums = (fields: readonly LayoutFormField[]): void => {
    for (const field of fields) {
      formNumByField.set(field, formObjectNums[formNumCursor++]!);
      if (field.fieldType !== "group" && field.widgets.length > 1) {
        formExtraWidgetNums.set(
          field,
          field.widgets.map(() => formObjectNums[formNumCursor++]!),
        );
      }
      claimFormNums(field.children);
    }
  };
  claimFormNums(doc.form ?? []);
  const formNumOf = (field: LayoutFormField): number => {
    const num = formNumByField.get(field);
    if (num === undefined) {
      throw new Error(
        "AcroForm field object number was not claimed — this is a writePdf internal invariant violation",
      );
    }
    return num;
  };

  // #967: the tagged structure tree. One object per element plus one for the /ParentTree number tree; element ids map to their object numbers in the same document-order walk that emits them. The walk both allocates and registers, so whether any element exists is simply whether the register is non-empty — no separate count to keep in agreement with it.
  const structElementNumById = new Map<string, number>();
  const allocateStructureElements = (
    elements: readonly LayoutStructureElement[],
  ): void => {
    for (const element of elements) {
      structElementNumById.set(element.id, nextObjNum++);
      allocateStructureElements(element.children);
    }
  };
  allocateStructureElements(doc.structure ?? []);
  const structRootNum =
    structElementNumById.size > 0 ? nextObjNum++ : undefined;
  const structParentTreeNum =
    structElementNumById.size > 0 ? nextObjNum++ : undefined;

  // #967: package-level residue. The XMP packet is the one row needing an object of its own (a /Metadata stream); every other restored row lands inline on the Catalog or the trailer, so no allocation.
  const residueXmpNum =
    doc.source?.xmp !== undefined ? nextObjNum++ : undefined;

  const objects: AllocatedObject[] = [];
  const catalogEntries: [string, PdfObject][] = [
    ["Type", pdfName("Catalog")],
    ["Pages", pdfRef(pagesNum, 0)],
  ];
  if (attachmentsNamesNum !== undefined) {
    catalogEntries.push(["Names", pdfRef(attachmentsNamesNum, 0)]);
  }
  if (outlineRootNum !== undefined) {
    catalogEntries.push(["Outlines", pdfRef(outlineRootNum, 0)]);
  }
  if (layerNumByName.size > 0) {
    const ocgRefs = [...layerNumByName.values()].map((num) => pdfRef(num, 0));
    const visible: PdfObject[] = [];
    const hidden: PdfObject[] = [];
    for (const layer of doc.layers ?? []) {
      const num = layerNumByName.get(layer.name)!;
      (layer.visible ? visible : hidden).push(pdfRef(num, 0));
    }
    // No /BaseState: the default is ON (the reader's own default), with each layer spelled explicitly into /ON or /OFF so its recovered state is exactly the model's, never an implicit default.
    const defaultConfigEntries: [string, PdfObject][] = [];
    if (visible.length > 0)
      defaultConfigEntries.push(["ON", pdfArray(visible)]);
    if (hidden.length > 0) defaultConfigEntries.push(["OFF", pdfArray(hidden)]);
    catalogEntries.push([
      "OCProperties",
      pdfDict({
        OCGs: pdfArray(ocgRefs),
        D: pdfDict(Object.fromEntries(defaultConfigEntries)),
      }),
    ]);
  }
  if (doc.form !== undefined && doc.form.length > 0) {
    catalogEntries.push([
      "AcroForm",
      pdfDict({
        Fields: pdfArray(doc.form.map((field) => pdfRef(formNumOf(field), 0))),
      }),
    ]);
  }
  if (structRootNum !== undefined) {
    catalogEntries.push(["StructTreeRoot", pdfRef(structRootNum, 0)]);
  }
  if (residueXmpNum !== undefined) {
    catalogEntries.push(["Metadata", pdfRef(residueXmpNum, 0)]);
  }
  // The restorable residue rows: each is re-parsed from its own serialised text back into a PdfObject and emitted inline under its original Catalog key (the trailer /ID is held for the trailer block below). A row whose parse names an indirect object of the SOURCE file cannot be restorable — its "N 0 R" targets an object number that need not exist in this file — so it is skipped rather than emitted as a dangling reference. The XMP packet (a standalone XML stream, never a reference-carrier) is restored as a /Metadata stream object; the page-boxes row is deliberately not restored at all — it records the SOURCE file's page geometry, which this writer states itself from each page's own dimensions. The open-action row is deliberately not restored either: /OpenAction is ACTIVE content (an inline JavaScript, Launch, or URI action a viewer executes on open), and restoring it verbatim from an attacker-supplied source would re-arm that behaviour in the rewritten file — an inert-destination allowlist is not worth the risk surface when the writer's own destinations and outline already carry navigation.
  const trailerIdRestore = restoreResidueRow(doc.source, "trailer-id");
  for (const [rowKey, catalogKey] of [
    ["viewer-preferences", "ViewerPreferences"],
    ["page-mode", "PageMode"],
    ["page-layout", "PageLayout"],
    ["output-intents", "OutputIntents"],
    ["piece-info", "PieceInfo"],
    ["legal", "Legal"],
    ["collection", "Collection"],
  ] as const) {
    const restored = restoreResidueRow(doc.source, rowKey);
    if (restored !== undefined) {
      catalogEntries.push([catalogKey, restored]);
    }
  }
  objects.push({
    num: catalogNum,
    value: pdfDict(Object.fromEntries(catalogEntries)),
  });
  objects.push({
    num: pagesNum,
    value: pdfDict({
      Type: pdfName("Pages"),
      Kids: pdfArray(pageAllocs.map((p) => pdfRef(p.pageNum, 0))),
      Count: pdfNum(doc.pages.length),
    }),
  });
  objects.push({ num: infoNum, value: buildInfoDict(doc) });

  for (const [index, attachment] of (doc.attachments ?? []).entries()) {
    const alloc = attachmentAllocs[index]!;
    // The embedded file stream: /Subtype carries the MIME type when the read side recovered one, spelled as the MIME value itself (the spec's own example uses "application/pdf" this way; a bare "text/plain" is equally legal).
    const fileEntries: [string, PdfObject][] = [
      ["Type", pdfName("EmbeddedFile")],
    ];
    if (attachment.mimeType !== undefined) {
      fileEntries.push(["Subtype", pdfName(attachment.mimeType)]);
    }
    objects.push({
      num: alloc.fileNum,
      value: pdfStream(
        pdfDict(Object.fromEntries(fileEntries)),
        base64ToBytes(attachment.base64),
      ),
    });
    // The filespec names the stream it wraps: /F is the file's own name, /Desc the human description, /EF the embedded-file reference itself. /UF is deliberately absent: this writer produces no Unicode file names to mirror, and a redundant /UF identical to /F resolves nothing a bare /F would not.
    const specEntries: [string, PdfObject][] = [
      ["Type", pdfName("Filespec")],
      ["F", pdfLiteralString(new TextEncoder().encode(attachment.name))],
      ["EF", pdfDict({ F: pdfRef(alloc.fileNum, 0) })],
    ];
    if (attachment.description !== undefined) {
      specEntries.push([
        "Desc",
        pdfLiteralString(new TextEncoder().encode(attachment.description)),
      ]);
    }
    objects.push({
      num: alloc.specNum,
      value: pdfDict(Object.fromEntries(specEntries)),
    });
  }
  if (attachmentsNamesNum !== undefined) {
    // The name-tree node: a flat /Names array of (name, filespec ref) pairs, the tree's own single-node shape — small attachment sets need no intermediate kids, and a writer that always produces one node keeps output deterministic.
    const names: PdfObject[] = [];
    for (const [index, attachment] of (doc.attachments ?? []).entries()) {
      names.push(pdfLiteralString(new TextEncoder().encode(attachment.name)));
      names.push(pdfRef(attachmentAllocs[index]!.specNum, 0));
    }
    objects.push({
      num: attachmentsNamesNum,
      value: pdfDict({
        // The /Names dict the Catalog references holds ONE child, /EmbeddedFiles, whose own /Names array is the flat name tree — the identical shape readAttachments walks (resolve catalog /Names, take its /EmbeddedFiles, walk that node's /Names) and the shape every real producer writes.
        EmbeddedFiles: pdfDict({ Names: pdfArray(names) }),
      }),
    });
  }

  emitOutlineObjects({
    objects,
    outlineItemNums,
    outlineRootNum,
    doc,
    pageAllocs,
  });

  // #967: optional-content groups. /Name as a text string exactly as the reader's own decodePdfString expects; visibility is stated only through the /OCProperties /D /ON and /OFF lists (no /BaseState), so a reader recovers each layer's state from the list it names, never from an implicit default.
  for (const layer of doc.layers ?? []) {
    const num = layerNumByName.get(layer.name)!;
    objects.push({
      num,
      value: pdfDict({
        Type: pdfName("OCG"),
        Name: pdfLiteralString(new TextEncoder().encode(layer.name)),
      }),
    });
  }

  // #967: the AcroForm field tree. A terminal field's FIRST widget merges into the field dict itself (/Subtype /Widget /Rect /P alongside /FT and friends) when it is the field's only one; a multi-widget field keeps every widget as a separate widget-kid object under /Kids, each also referenced from its page's /Annots. A group is a bare /T + /Kids node. Fully-qualified names decompose back into the /T chain: a root field carries its whole name, a nested field carries the segment beyond its parent's, exactly the join the reader re-applies (ISO 32000-1 12.7.3.2). Each widget's page /Annots entry, gathered during emission in field order: the merged field dict itself for a single-widget field (it IS the annotation), the widget kid object for the others. A viewer that renders only page-level /Annots — and the spec's own presentation model points it there (ISO 32000-1 12.5.1) — sees every widget without knowing the AcroForm tree at all.
  const widgetAnnotsByPage = new Map<number, PdfObject[]>();
  emitFormObjects(
    {
      objects,
      widgetAnnotsByPage,
      pageAllocs,
      formNumOf,
      formExtraWidgetNums,
    },
    doc.form ?? [],
  );

  // #967: the tagged structure tree. One /StructElem per model element (/S the type, /P the parent — the root for top-level elements, /K the child refs), and the /StructTreeRoot pointing at both the element roots and the /ParentTree number tree built after the page walk below (it depends on the per-page MCID assignments).
  if (structRootNum !== undefined) {
    const emitStructureElement = (
      element: LayoutStructureElement,
      parentNum: number,
    ): void => {
      const entries: [string, PdfObject][] = [
        ["Type", pdfName("StructElem")],
        ["S", pdfName(element.type)],
        ["P", pdfRef(parentNum, 0)],
      ];
      if (element.title !== undefined) {
        entries.push([
          "T",
          pdfLiteralString(new TextEncoder().encode(element.title)),
        ]);
      }
      if (element.language !== undefined) {
        entries.push([
          "Lang",
          pdfLiteralString(new TextEncoder().encode(element.language)),
        ]);
      }
      if (element.alt !== undefined) {
        entries.push([
          "Alt",
          pdfLiteralString(new TextEncoder().encode(element.alt)),
        ]);
      }
      if (element.actualText !== undefined) {
        entries.push([
          "ActualText",
          pdfLiteralString(new TextEncoder().encode(element.actualText)),
        ]);
      }
      if (element.children.length > 0) {
        entries.push([
          "K",
          pdfArray(
            element.children.map((child) => {
              const num = structElementNumById.get(child.id);
              if (num === undefined) {
                throw new Error(
                  `structure element "${child.id}" was not allocated — this is a writePdf internal invariant violation`,
                );
              }
              return pdfRef(num, 0);
            }),
          ),
        ]);
      }
      const ownNum = structElementNumById.get(element.id);
      if (ownNum === undefined) {
        throw new Error(
          `structure element "${element.id}" was not allocated — this is a writePdf internal invariant violation`,
        );
      }
      objects.push({
        num: ownNum,
        value: pdfDict(Object.fromEntries(entries)),
      });
      for (const child of element.children) {
        emitStructureElement(child, ownNum);
      }
    };
    for (const element of doc.structure ?? []) {
      emitStructureElement(element, structRootNum);
    }
  }

  // #967: the XMP packet restored as an uncompressed /Metadata stream — the read side decodes it back verbatim.
  if (residueXmpNum !== undefined && doc.source?.xmp !== undefined) {
    objects.push({
      num: residueXmpNum,
      value: pdfStream(
        pdfDict({ Type: pdfName("Metadata"), Subtype: pdfName("XML") }),
        new TextEncoder().encode(doc.source.xmp.xml),
      ),
    });
  }

  for (const [standardName, alloc] of fontAllocs) {
    const { font, descriptor } = buildFontObjects(
      standardName,
      pdfRef(alloc.descNum, 0),
    );
    objects.push({ num: alloc.fontNum, value: font });
    objects.push({ num: alloc.descNum, value: descriptor });
  }

  for (const alloc of imageAllocs.values()) {
    if (alloc.smaskNum !== undefined && alloc.prepared.alpha !== undefined) {
      alloc.prepared.dict.entries.set("SMask", pdfRef(alloc.smaskNum, 0));
      objects.push({
        num: alloc.smaskNum,
        value: pdfStream(alloc.prepared.alpha.dict, alloc.prepared.alpha.raw),
      });
    }
    if (alloc.globalsNum !== undefined && alloc.globalsBase64 !== undefined) {
      // The verbatim /JBIG2Globals stream re-emitted as its own object, rebuilt from the decoded segments the reader captured: the globals are JBIG2 segment data, not a compressed image, so they travel under a plain (optionally Flate) transport the same way any producer writes them.
      const globalsRaw = base64ToBytes(alloc.globalsBase64);
      alloc.prepared.dict.entries.set(
        "DecodeParms",
        pdfDict({ JBIG2Globals: pdfRef(alloc.globalsNum, 0) }),
      );
      objects.push({
        num: alloc.globalsNum,
        value: pdfStream(
          pdfDict(
            compress
              ? new Map<string, PdfObject>([["Filter", pdfName("FlateDecode")]])
              : new Map<string, PdfObject>(),
          ),
          compress ? deflate(globalsRaw) : globalsRaw,
        ),
      });
    }
    objects.push({
      num: alloc.imageNum,
      value: pdfStream(alloc.prepared.dict, alloc.prepared.raw),
    });
  }

  const mathFontResult = emitFontObjects({
    objects,
    formulas,
    mathFontAlloc,
    embeddedAllocs,
    compress,
  });
  const mathFont =
    mathFontResult === undefined ? undefined : mathFontResult.font;

  const resourceEntries = new Map<string, PdfObject>();
  if (
    fontAllocs.size > 0 ||
    embeddedAllocs.size > 0 ||
    mathFontAlloc !== undefined
  ) {
    const fontEntries = new Map<string, PdfObject>(
      [...fontAllocs.values()].map((alloc) => [
        alloc.resourceName,
        pdfRef(alloc.fontNum, 0),
      ]),
    );
    for (const alloc of embeddedAllocs.values()) {
      fontEntries.set(alloc.resourceName, pdfRef(alloc.type0Num, 0));
    }
    if (mathFontAlloc !== undefined) {
      fontEntries.set(
        mathFontAlloc.resourceName,
        pdfRef(mathFontAlloc.type0Num, 0),
      );
    }
    resourceEntries.set("Font", pdfDict(fontEntries));
  }
  if (imageAllocs.size > 0) {
    resourceEntries.set(
      "XObject",
      pdfDict(
        new Map(
          [...imageAllocs.values()].map((alloc) => [
            alloc.resourceName,
            pdfRef(alloc.imageNum, 0),
          ]),
        ),
      ),
    );
  }
  const resourcesDict = pdfDict(resourceEntries);

  const markedStructureByPage = emitPageObjects({
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
  });

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
          (doc.structure ?? []).map((element) => {
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

  // Encryption runs as a final pass over the fully-assembled object graph, rather than being threaded through every object-construction call above: every string and stream this writer produces needs the identical treatment (Algorithm 1/1.A, keyed by that object's own number), so one recursive walk here is the same DRY move document.ts's own decryptDict/decryptObject already makes on the read side. The /Encrypt dictionary object itself is allocated and appended only afterwards, so this walk never touches it — ISO 32000-2 7.6.1 requires its own O/U/OE/UE/Perms strings to stay in the clear.
  let fileId: Uint8Array<ArrayBuffer> | undefined;
  let encryptedObjects = objects;
  if (options.encryption !== undefined && encryptDictNum !== undefined) {
    fileId = randomBytes(FILE_ID_BYTES);
    const encryptor = createStandardEncryptor(options.encryption, fileId);
    encryptedObjects = objects.map(({ num, value }) => ({
      num,
      value: encryptIndirectObject(value, num, 0, encryptor),
    }));
    encryptedObjects.push({
      num: encryptDictNum,
      value: encryptor.encryptDict,
    });
  }

  const writer = new ByteWriter();
  writer.writeAscii("%PDF-1.7\n");
  const offsets = new Map<number, number>();
  for (const { num, value } of encryptedObjects) {
    offsets.set(num, writer.length);
    writer.writeAscii(`${num} 0 obj\n`);
    writeObject(writer, value);
    writer.writeAscii("\nendobj\n");
  }

  const maxObjNum = nextObjNum - 1;
  const xrefOffset = writer.length;
  writer.writeAscii("xref\n");
  writer.writeAscii(`0 ${maxObjNum + 1}\n`);
  // ISO 32000-1 7.5.4: object number 0 is always free, and its entry's own generation number is always this constant, the largest value a 5-digit generation field can hold.
  const XREF_FREE_LIST_HEAD_GENERATION = 65535;
  writer.writeAscii(xrefEntry(0, XREF_FREE_LIST_HEAD_GENERATION, false));
  for (let num = 1; num <= maxObjNum; num++) {
    const offset = offsets.get(num);
    if (offset === undefined) {
      throw new Error(
        `object ${num} was allocated but never written — this is a writePdf internal invariant violation`,
      );
    }
    writer.writeAscii(xrefEntry(offset, 0, true));
  }

  const trailerEntries = new Map<string, PdfObject>([
    ["Size", pdfNum(maxObjNum + 1)],
    ["Root", pdfRef(catalogNum, 0)],
    ["Info", pdfRef(infoNum, 0)],
  ]);
  if (fileId !== undefined && encryptDictNum !== undefined) {
    trailerEntries.set(
      "ID",
      pdfArray([pdfHexString(fileId), pdfHexString(fileId)]),
    );
    trailerEntries.set("Encrypt", pdfRef(encryptDictNum, 0));
  } else if (trailerIdRestore !== undefined) {
    // #967: the quarantined trailer /ID restored verbatim (the one residue row that belongs to the trailer, not the Catalog). An encrypted document keeps its own freshly minted ID — the encryption keys are derived from it.
    trailerEntries.set("ID", trailerIdRestore);
  }
  writer.writeAscii("trailer\n");
  writeObject(writer, pdfDict(trailerEntries));
  writer.writeAscii("\nstartxref\n");
  writer.writeAscii(`${xrefOffset}\n`);
  writer.writeAscii("%%EOF");

  return writer.toBytes();
}
