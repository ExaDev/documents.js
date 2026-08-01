import { ByteWriter } from './bytes/writer';
import type { MathColor, MathGlyphRun, MathRule, MathStroke } from './math-types';
import type { PositionedFormula } from './formula';
import type { MathFont } from './math-font';
import { pdfHexString } from './objects';
import { formatNumber, writeObject } from './serialize';

// Renders a page's own PositionedFormula[] into PDF content-stream operator bytes -- the formula-specific counterpart to content-write.ts's writeContentStream, kept as its own module (rather than a new branch inside that one) because a formula's own text-showing genuinely differs from writeText's own WinAnsi/standard-14 path at the byte level: every glyph run here is shown through the embedded CID composite math font (src/pdf/math-font.ts) via Identity-H 2-byte-big-endian CIDs, never a WinAnsi-encoded 1-byte string. See write.ts's own module comment for why this can't simply be another LayoutItem kind instead.
export interface MathContentWriteContext {
  readonly font: MathFont;
  readonly resourceName: string; // e.g. 'MF' -- the key under the page's own /Resources/Font dict write.ts allocates for the embedded math font
}

// A MathBox's own items are positioned box-local (top-left origin, y-down -- see layout-types.ts's own module comment); `positioned.xPt/yPt` is that box's bottom-left corner in PDF page space (bottom-left origin, y-up -- the same convention flipY produces for every other LayoutItem). These two convert one to the other: an item's box-local x is a plain left-to-right offset from the box's own left edge either way, but its y needs re-anchoring from "distance down from the box's own top" to "distance up from the page's own bottom".
function toPdfX(positioned: PositionedFormula, itemXPt: number): number {
  return positioned.xPt + itemXPt;
}
function toPdfY(positioned: PositionedFormula, itemYPt: number): number {
  return positioned.yPt + positioned.box.heightPt - itemYPt;
}

function writeRgbOperator(writer: ByteWriter, color: MathColor, operator: 'rg' | 'RG'): void {
  writer.writeAscii(`${formatNumber(color.r)} ${formatNumber(color.g)} ${formatNumber(color.b)} ${operator}\n`);
}

// Every code point in `text`, resolved to its own glyph ID via the embedded font's cmap and packed as a big-endian uint16 -- the CID sequence an Identity-H Tj operand needs. A code point layoutToken (src/mathml/layout.ts) already measured has a glyph by construction (it would have been dropped with a 'missing-glyph' diagnostic otherwise, never reaching this far) -- glyphId returning undefined here would mean the font changed between layout and writing, an internal invariant violation this function defends against by simply skipping that one character rather than crashing the whole write.
function encodeGlyphRunToCids(font: MathFont, text: string): Uint8Array<ArrayBuffer> {
  const gids: number[] = [];
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    const glyphId = font.glyphId(codePoint);
    if (glyphId !== undefined) {
      gids.push(glyphId);
    }
  }
  const bytes = new Uint8Array(gids.length * 2);
  gids.forEach((gid, index) => {
    bytes[index * 2] = (gid >> 8) & 0xff;
    bytes[index * 2 + 1] = gid & 0xff;
  });
  return bytes;
}

function writeGlyphRun(writer: ByteWriter, positioned: PositionedFormula, item: MathGlyphRun, ctx: MathContentWriteContext): void {
  const cidBytes = encodeGlyphRunToCids(ctx.font, item.text);
  if (cidBytes.length === 0) {
    return;
  }
  const x = toPdfX(positioned, item.xPt);
  const y = toPdfY(positioned, item.yPt);
  writer.writeAscii('BT\n');
  writer.writeAscii(`/${ctx.resourceName} ${formatNumber(item.sizePt)} Tf\n`);
  writeRgbOperator(writer, item.color, 'rg');
  writer.writeAscii(`1 0 0 1 ${formatNumber(x)} ${formatNumber(y)} Tm\n`);
  writeObject(writer, pdfHexString(cidBytes));
  writer.writeAscii(' Tj\n');
  writer.writeAscii('ET\n');
}

function writeRule(writer: ByteWriter, positioned: PositionedFormula, item: MathRule): void {
  const x = toPdfX(positioned, item.xPt);
  const topY = toPdfY(positioned, item.yPt);
  writeRgbOperator(writer, item.color, 'rg');
  writer.writeAscii(`${formatNumber(x)} ${formatNumber(topY - item.heightPt)} ${formatNumber(item.widthPt)} ${formatNumber(item.heightPt)} re\n`);
  writer.writeAscii('f\n');
}

function writeStroke(writer: ByteWriter, positioned: PositionedFormula, item: MathStroke): void {
  if (item.points.length < 2) {
    return;
  }
  writeRgbOperator(writer, item.color, 'RG');
  writer.writeAscii(`${formatNumber(item.widthPt)} w\n`);
  item.points.forEach((point, index) => {
    const x = toPdfX(positioned, point.xPt);
    const y = toPdfY(positioned, point.yPt);
    writer.writeAscii(`${formatNumber(x)} ${formatNumber(y)} ${index === 0 ? 'm' : 'l'}\n`);
  });
  writer.writeAscii('S\n');
}

// Renders every formula targeting one page into that page's own content-stream bytes, appended after the ordinary LayoutItem-driven bytes writeContentStream already produced -- see write.ts's own call site.
export function writeFormulaContentStream(formulas: readonly PositionedFormula[], ctx: MathContentWriteContext): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  for (const positioned of formulas) {
    for (const item of positioned.box.items) {
      if (item.kind === 'glyphs') {
        writeGlyphRun(writer, positioned, item, ctx);
      } else if (item.kind === 'rule') {
        writeRule(writer, positioned, item);
      } else {
        writeStroke(writer, positioned, item);
      }
    }
  }
  return writer.toBytes();
}

// Every Unicode code point actually used across `formulas`' own glyph runs, resolved to its own glyph ID -- the exact, minimal set write.ts's own math font allocation needs for its /W widths array and ToUnicode CMap, even though the embedded CFF program itself carries the font's full, unmodified glyph repertoire (see math-font.ts's own module comment on why). Keyed by glyph ID (= CID, see math-font.ts) with the first code point seen mapped to it -- the cmap this font's glyphId() reads is a proper injective Unicode->glyph mapping for every code point this package's own mathvariant mapping ever produces, so a glyph ID mapping to more than one distinct code point across a whole document is not expected to occur.
export function collectUsedGlyphs(formulas: readonly PositionedFormula[], font: MathFont): ReadonlyMap<number, number> {
  const used = new Map<number, number>();
  for (const positioned of formulas) {
    for (const item of positioned.box.items) {
      if (item.kind !== 'glyphs') {
        continue;
      }
      for (const ch of item.text) {
        const codePoint = ch.codePointAt(0);
        if (codePoint === undefined) {
          continue;
        }
        const glyphId = font.glyphId(codePoint);
        if (glyphId !== undefined && !used.has(glyphId)) {
          used.set(glyphId, codePoint);
        }
      }
    }
  }
  return used;
}
