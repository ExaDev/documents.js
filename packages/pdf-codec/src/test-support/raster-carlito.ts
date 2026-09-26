// The Carlito embedded-font PDF builders and the SmallFixture harness shared by the raster image and text suites, extracted so neither suite imports the other (a test file importing another test file makes vitest run the imported file's tests twice).
import { ByteWriter } from "../bytes/writer";
import { buildCmapLookup } from "../cmap-table";
import { parseHead, parseMaxp } from "../font-tables";
import { parseHmtx } from "../hmtx-table";
import { parseSfnt } from "../sfnt";
import { carlitoRegularBytes } from "./fonts";
import { enc } from "./pdf";

export class SmallFixture {
  private readonly writer = new ByteWriter();
  private readonly offsets = new Map<number, number>();

  constructor() {
    this.writer.writeAscii("%PDF-1.7\n");
  }

  object(num: number, body: string): this {
    this.offsets.set(num, this.writer.length);
    this.writer.writeAscii(`${num} 0 obj\n${body}\nendobj\n`);
    return this;
  }

  stream(
    num: number,
    dictWithoutLength: string,
    raw: Uint8Array<ArrayBuffer>,
  ): this {
    this.offsets.set(num, this.writer.length);
    const dict = dictWithoutLength.replace(
      />>\s*$/,
      ` /Length ${raw.length} >>`,
    );
    this.writer.writeAscii(`${num} 0 obj\n${dict}\nstream\n`);
    this.writer.writeBytes(raw);
    this.writer.writeAscii("\nendstream\nendobj\n");
    return this;
  }

  bytes(): Uint8Array<ArrayBuffer> {
    return this.writer.toBytes();
  }

  classicXrefAndTrailer(
    maxObjNum: number,
    trailerExtra: string,
  ): Uint8Array<ArrayBuffer> {
    const xrefOffset = this.writer.length;
    this.writer.writeAscii(`xref\n0 ${maxObjNum + 1}\n`);
    this.writer.writeAscii("0000000000 65535 f \n");
    for (let n = 1; n <= maxObjNum; n++) {
      const offset = this.offsets.get(n);
      this.writer.writeAscii(
        offset === undefined
          ? "0000000000 00000 f \n" // an object number this fixture never wrote: a legal free entry, so a font chain can leave gaps in the numbering
          : `${offset.toString().padStart(10, "0")} 00000 n \n`,
      );
    }
    this.writer.writeAscii(
      `trailer\n<< /Size ${maxObjNum + 1} ${trailerExtra} >>\nstartxref\n${xrefOffset}\n%%EOF`,
    );
    return this.writer.toBytes();
  }
}

export function type0CarlitoPdf(
  text: string,
  textState = "",
): Uint8Array<ArrayBuffer> {
  const bytes = carlitoRegularBytes();
  const sfnt = parseSfnt(bytes);
  const head = parseHead(sfnt!);
  const maxp = parseMaxp(sfnt!);
  const cmap = buildCmapLookup(sfnt!);
  const hmtx = parseHmtx(sfnt!);
  if (
    head === undefined ||
    maxp === undefined ||
    cmap === undefined ||
    sfnt === undefined
  ) {
    throw new Error("fixture setup: Carlito tables unreadable");
  }
  const glyphIds = [...text].map((ch) => cmap(ch.codePointAt(0)!));
  if (glyphIds.some((gid) => gid === undefined)) {
    throw new Error(`fixture setup: no glyph for "${text}"`);
  }
  const shown = glyphIds
    .map((gid) => (gid! + 0x10000).toString(16).slice(-4).toUpperCase())
    .join("");
  const widths = glyphIds
    .map(
      (gid) =>
        ` ${gid} [${(hmtx.advanceWidth(gid!) * (1000 / head.unitsPerEm)).toFixed(2)}]`,
    )
    .join("");

  const b = new SmallFixture();
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  b.object(
    4,
    `<< /Type /Font /Subtype /Type0 /BaseFont /Carlito /Encoding /Identity-H /DescendantFonts [7 0 R] >>`,
  );
  b.object(
    7,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Carlito /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 1000 /W [${widths} ] /CIDToGIDMap /Identity >>`,
  );
  b.object(
    8,
    `<< /Type /FontDescriptor /FontName /Carlito /Flags 32 /FontBBox [${head.xMin} ${head.yMin} ${head.xMax} ${head.yMax}] /ItalicAngle 0 /Ascent ${head.yMax} /Descent ${head.yMin} /CapHeight ${head.yMax} /StemV 80 /FontFile2 9 0 R >>`,
  );
  b.stream(9, `<< /Length1 ${bytes.length} >>`, bytes);
  b.stream(
    5,
    "<< >>",
    enc(`BT /F1 24 Tf ${textState} 20 50 Td <${shown}> Tj ET`),
  );
  return b.classicXrefAndTrailer(9, "/Root 1 0 R");
}

export function trueTypeCarlitoPdf(
  text: string,
  overrides: {
    readonly fontDescriptorBody?: string;
    readonly fontBytes?: Uint8Array<ArrayBuffer>;
  } = {},
): Uint8Array<ArrayBuffer> {
  const fontBytes = overrides.fontBytes ?? carlitoRegularBytes();
  const b = new SmallFixture();
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  b.object(
    4,
    "<< /Type /Font /Subtype /TrueType /BaseFont /Carlito /FirstChar 0 /LastChar 255 /FontDescriptor 8 0 R >>",
  );
  b.object(
    8,
    overrides.fontDescriptorBody ??
      "<< /Type /FontDescriptor /FontName /Carlito /Flags 32 /FontFile2 9 0 R >>",
  );
  b.stream(9, `<< /Length1 ${fontBytes.length} >>`, fontBytes);
  b.stream(5, "<< >>", enc(`BT /F1 24 Tf 20 50 Td (${text}) Tj ET`));
  return b.classicXrefAndTrailer(9, "/Root 1 0 R");
}
