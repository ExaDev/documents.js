import { zlibSync } from 'fflate';
import { ByteWriter } from '../bytes/writer';

// Hand-built PDF fixtures for the parser (src/pdf/lexer.ts and friends), by literal byte/string concatenation with this file's own local offset tracking -- deliberately importing NOTHING from src/pdf/ itself. A PDF fixture built by calling this package's own writePdf would let a writer bug hide from the reader test and vice versa; the write-side and read-side test oracles must be genuinely independent, not just nominally separate files. Using fflate's zlibSync directly here (for a compressed xref/object stream) is legitimate, not a violation of that independence -- fflate is the shared DEFLATE oracle both sides already depend on; what's being independently constructed is the PDF structure around it, not the compression algorithm.
//
// Do NOT refactor this to call src/pdf/write.ts, however tempting the duplication looks -- that would silently destroy the whole point of this file.

function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// Tracks byte offsets as objects are appended, purely by recording ByteWriter's own running length before each write -- the same mechanical idea src/pdf/write.ts uses, reimplemented independently here rather than shared with it.
class FixtureBuilder {
  private readonly writer = new ByteWriter();
  private readonly offsets = new Map<number, number>();

  get length(): number {
    return this.writer.length;
  }

  header(version = '1.7'): this {
    this.writer.writeAscii(`%PDF-${version}\n`);
    return this;
  }

  raw(text: string): this {
    this.writer.writeAscii(text);
    return this;
  }

  rawBytes(bytes: Uint8Array<ArrayBuffer>): this {
    this.writer.writeBytes(bytes);
    return this;
  }

  object(num: number, body: string): this {
    this.offsets.set(num, this.writer.length);
    this.writer.writeAscii(`${num} 0 obj\n${body}\nendobj\n`);
    return this;
  }

  // `dict` must NOT include /Length -- it's computed from `raw`'s actual byte length and inserted automatically, exactly mirroring the real writer's own guarantee that /Length can never drift from the bytes that follow.
  stream(num: number, dictWithoutLength: string, raw: Uint8Array<ArrayBuffer>): this {
    this.offsets.set(num, this.writer.length);
    const dict = dictWithoutLength.replace(/>>\s*$/, ` /Length ${raw.length} >>`);
    this.writer.writeAscii(`${num} 0 obj\n${dict}\nstream\n`);
    this.writer.writeBytes(raw);
    this.writer.writeAscii('\nendstream\nendobj\n');
    return this;
  }

  offsetOf(num: number): number {
    const offset = this.offsets.get(num);
    if (offset === undefined) {
      throw new Error(`fixture object ${num} was never written`);
    }
    return offset;
  }

  // A classic (ISO 32000-1 7.5.4) cross-reference table covering objects 0..maxObjNum, each entry padded to the mandatory fixed 20 bytes.
  classicXrefAndTrailer(maxObjNum: number, trailerExtra: string): this {
    const xrefOffset = this.writer.length;
    this.writer.writeAscii(`xref\n0 ${maxObjNum + 1}\n`);
    this.writer.writeAscii('0000000000 65535 f \n');
    for (let n = 1; n <= maxObjNum; n++) {
      this.writer.writeAscii(`${this.offsetOf(n).toString().padStart(10, '0')} 00000 n \n`);
    }
    this.writer.writeAscii(`trailer\n<< /Size ${maxObjNum + 1} ${trailerExtra} >>\nstartxref\n${xrefOffset}\n%%EOF`);
    return this;
  }

  bytes(): Uint8Array<ArrayBuffer> {
    return this.writer.toBytes();
  }
}

const HELLO_CONTENT = 'BT /F1 12 Tf 10 50 Td (Hello) Tj ET';

function catalogPagesPageFontObjects(b: FixtureBuilder, contentObjNum: number, mediaBox = '[0 0 200 100]', extraPageEntries = ''): void {
  b.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  b.object(3, `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Resources << /Font << /F1 4 0 R >> >> /Contents ${contentObjNum} 0 R ${extraPageEntries}>>`);
  b.object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
}

// A minimal, structurally ordinary PDF: classic xref table, a literal (parenthesized) content-stream string -- the OTHER string form our own writer never emits (it always emits hex strings), so a fixture using this form specifically exercises the parser's literal-string handling rather than only round-tripping what our own writer happens to produce.
export function minimalClassicXrefPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5);
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.classicXrefAndTrailer(5, '/Root 1 0 R');
  return b.bytes();
}

// The single highest-value fixture in the suite: Word/PowerPoint/Chrome/LibreOffice all default to PDF 1.5+ cross-reference *streams* with object streams, not the classic table our own writer emits -- a reader that only handles the classic form would fail on the overwhelming majority of real-world, non-self-produced PDFs. Catalog/Pages/Page are packed into one compressed object stream (a stream object itself is never permitted inside an object stream, per ISO 32000-1 7.5.7, so the content stream, the object stream, and the xref stream itself all remain ordinary top-level objects). The xref stream is self-referential: its own entry describes its own byte offset.
export function xrefStreamWithObjectStreamPdf(): Uint8Array<ArrayBuffer> {
  const catalogBody = '<< /Type /Catalog /Pages 2 0 R >>';
  const pagesBody = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  const pageBody = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 5 0 R >>';

  // ObjStm body: a header of "objNum offset" pairs (offsets relative to /First, i.e. relative to the start of the object data that follows the header), then each object's own value in the same order -- ISO 32000-1 7.5.7.
  const entries: readonly { readonly num: number; readonly body: string }[] = [
    { num: 1, body: catalogBody },
    { num: 2, body: pagesBody },
    { num: 3, body: pageBody },
  ];
  let objectData = '';
  const dataOffsets: number[] = [];
  for (const entry of entries) {
    dataOffsets.push(objectData.length);
    objectData += `${entry.body} `;
  }
  const header = entries.map((entry, i) => `${entry.num} ${dataOffsets[i]}`).join(' ');
  const objStmDecoded = enc(`${header}\n${objectData}`);
  const objStmCompressed = zlibSync(objStmDecoded);

  const b = new FixtureBuilder().header('1.5');
  b.stream(4, `<< /Type /ObjStm /N ${entries.length} /First ${header.length + 1} /Filter /FlateDecode >>`, objStmCompressed);
  b.stream(5, '<< >>', enc(HELLO_CONTENT));

  // /W [1 4 2]: 1-byte type, 4-byte second field, 2-byte third field -- type 2 (compressed) rows store the containing ObjStm's object number and the index within it; type 1 (uncompressed) rows store a plain byte offset and generation.
  const rows: number[][] = [
    [0, 0, 0, 0, 0, 255, 255], // object 0: the conventional free-list head
    [2, 0, 0, 0, 4, 0, 0], // object 1 (Catalog): in ObjStm 4, index 0
    [2, 0, 0, 0, 4, 0, 1], // object 2 (Pages): index 1
    [2, 0, 0, 0, 4, 0, 2], // object 3 (Page): index 2
  ];
  const objStmOffset = b.offsetOf(4);
  const contentOffset = b.offsetOf(5);
  rows.push([1, ...be4(objStmOffset), 0, 0]);
  rows.push([1, ...be4(contentOffset), 0, 0]);
  const xrefObjNum = 6;
  // The xref stream's own row references its own not-yet-written offset -- known in advance because FixtureBuilder assigns it the moment `stream()` is called, before any bytes are written.
  const xrefOffsetPlaceholderIndex = rows.length;
  rows.push([1, 0, 0, 0, 0, 0, 0]); // patched below once the real offset is known

  const xrefOffset = b.length; // object 6 (the xref stream) starts here, matching what stream(6, ...) is about to record
  rows[xrefOffsetPlaceholderIndex] = [1, ...be4(xrefOffset), 0, 0];
  const xrefRows = new Uint8Array(rows.length * 7);
  rows.forEach((row, i) => xrefRows.set(row, i * 7));
  const xrefCompressed = zlibSync(xrefRows);

  b.stream(xrefObjNum, `<< /Type /XRef /Size ${rows.length} /W [1 4 2] /Index [0 ${rows.length}] /Root 1 0 R /Filter /FlateDecode >>`, xrefCompressed);
  b.raw(`startxref\n${xrefOffset}\n%%EOF`);
  return b.bytes();
}

function be4(n: number): [number, number, number, number] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

// startxref points at a nonsense offset -- the parser must fall back to a linear scan for "N G obj" patterns to rebuild the xref table from scratch, then raise a recovery diagnostic rather than failing outright.
export function brokenStartxrefPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5);
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.raw(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n999999\n%%EOF`);
  return b.bytes();
}

// A first revision followed by an incremental update: object 3 (the Page) is redefined by a second, later xref section chained via /Prev to the first. A reader must walk /Prev newest-first and take the FIRST definition of each object number it encounters (the later revision), while objects the second revision doesn't touch (1, 2, 4, 5) still resolve through the original section.
export function incrementalUpdatePdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5, '[0 0 200 100]');
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  const firstXrefOffset = b.length;
  b.raw('xref\n0 6\n');
  b.raw('0000000000 65535 f \n');
  for (let n = 1; n <= 5; n++) {
    b.raw(`${b.offsetOf(n).toString().padStart(10, '0')} 00000 n \n`);
  }
  b.raw('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n');
  b.raw(`${firstXrefOffset}\n%%EOF\n`);

  // Incremental update: object 3 redefined with a larger MediaBox.
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  const secondXrefOffset = b.length;
  b.raw('xref\n3 1\n');
  b.raw(`${b.offsetOf(3).toString().padStart(10, '0')} 00000 n \n`);
  b.raw(`trailer\n<< /Size 6 /Root 1 0 R /Prev ${firstXrefOffset} >>\nstartxref\n`);
  b.raw(`${secondXrefOffset}\n%%EOF`);
  return b.bytes();
}

// /Encrypt present -- readPdf must throw a clear, specific "this PDF is encrypted and unsupported" error rather than a generic parse failure, even for the common empty-user-password case this fixture represents (a real /Encrypt dict would carry /Filter /Standard /V /R /O /U /P; this fixture only needs the key the reader is required to notice).
export function encryptedPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5);
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.object(6, '<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>');
  b.classicXrefAndTrailer(6, '/Root 1 0 R /Encrypt 6 0 R');
  return b.bytes();
}

// A page rotated 90 degrees clockwise (/Rotate, ISO 32000-1's own page-rotation attribute -- distinct from any content-stream rotation matrix).
export function rotatedPagePdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5, '[0 0 200 100]', '/Rotate 90 ');
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.classicXrefAndTrailer(5, '/Root 1 0 R');
  return b.bytes();
}

// A /MediaBox whose origin isn't (0,0) -- our own writer never produces one (see write.ts's own module doc), but real producers occasionally do; placement must be computed relative to the MediaBox's own origin, not assumed to be (0,0).
export function nonZeroOriginMediaBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5, '[50 50 250 150]');
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.classicXrefAndTrailer(5, '/Root 1 0 R');
  return b.bytes();
}

// A page whose content invokes a form XObject (/Subtype /Form) -- common output from LibreOffice and other producers that wrap page content in a reusable form. The interpreter must recurse into it, composing the form's own /Matrix into the CTM.
export function formXObjectPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> /XObject << /Fm1 6 0 R >> >> /Contents 5 0 R >>');
  b.object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageContent = 'q 1 0 0 1 20 20 cm /Fm1 Do Q';
  b.stream(5, '<< >>', enc(pageContent));
  const formContent = 'BT /F1 12 Tf 0 0 Td (In a form) Tj ET';
  b.stream(6, '<< /Type /XObject /Subtype /Form /BBox [0 0 100 50] /Resources << /Font << /F1 4 0 R >> >> >>', enc(formContent));
  b.classicXrefAndTrailer(6, '/Root 1 0 R');
  return b.bytes();
}

// A content stream using the inline-image form (BI ... ID <binary> EI) rather than a full Image XObject -- its end must be located by scanning for EI (no /Length is available for inline images), which is a distinct, easy-to-desynchronize code path from the XObject case.
export function inlineImagePdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5);
  const pixelData = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]); // 2x2 RGB, raw
  const writer = new ByteWriter();
  writer.writeAscii('q 100 0 0 100 10 0 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID ');
  writer.writeBytes(pixelData);
  writer.writeAscii(' EI Q');
  b.stream(5, '<< >>', writer.toBytes());
  b.classicXrefAndTrailer(5, '/Root 1 0 R');
  return b.bytes();
}

// Two pages under a Pages node that itself carries /MediaBox and /Resources -- neither Page defines them directly, so a reader must inherit both down from the Pages node (ISO 32000-1 7.7.3.4, Table 30). The second page additionally sets its own /Rotate, which an inheriting reader must not overwrite with any (here absent) inherited value.
export function inheritedPageAttributesPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>');
  b.object(4, '<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Rotate 90 >>');
  b.object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  b.stream(6, '<< >>', enc(HELLO_CONTENT));
  b.classicXrefAndTrailer(6, '/Root 1 0 R');
  return b.bytes();
}

// A page with a hidden /Subtype /Text annotation NOT authored by documents.js's own writer (a different /T, as a real third-party tool's own sticky note would have) -- proves readPageNotes's /T-marker check genuinely discriminates our own notes annotation from someone else's, rather than treating every hidden Text annotation as recovered pptx notes.
export function pdfWithForeignHiddenAnnotationPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5, '[0 0 200 100]', '/Annots [6 0 R] ');
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.object(6, '<< /Type /Annot /Subtype /Text /Rect [0 0 0 0] /Contents (A real reviewer note, not pptx speaker notes) /T (Some Other Tool) /F 2 >>');
  b.classicXrefAndTrailer(6, '/Root 1 0 R');
  return b.bytes();
}

// An /Info dict mixing the two real-world string encodings a reader must handle: /Title as UTF-16BE-with-BOM (our own writer's own convention, ISO 32000-1 7.9.2.2's "long form"), and /Author/Keywords as plain literal-string PDFDocEncoding (the common case for ASCII-only metadata most third-party producers emit). /CreationDate uses the PDF date format (ISO 32000-1 7.9.4) with an explicit UTC+02:00 offset.
export function withInfoDictPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5);
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  const titleHex = `feff${Array.from('Test Doc')
    .map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')}`;
  b.object(6, `<< /Title <${titleHex}> /Author (Jane Smith) /Keywords (alpha, beta) /CreationDate (D:20240115103000+02'00') >>`);
  b.classicXrefAndTrailer(6, '/Root 1 0 R /Info 6 0 R');
  return b.bytes();
}
