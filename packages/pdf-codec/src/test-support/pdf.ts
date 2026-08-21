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

// A structurally valid document with an empty page tree: the page loop over doc.pages() has zero iterations, so a signal whose only check lives inside that loop would never be consulted -- the abort-contract gap this fixture exists to hold closed.
export function pagelessPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  b.object(2, '<< /Type /Pages /Kids [] /Count 0 >>');
  b.classicXrefAndTrailer(2, '/Root 1 0 R');
  return b.bytes();
}

// A two-page document whose FIRST page has no /Resources dict (a deterministic, per-page-1 recoverable warning through the sink) and whose second page carries ordinary text content. Reading it with a signal that the sink aborts on page 1's warning distinguishes "the page loop checks between pages" (throws before page 2 is ever interpreted) from "the signal is only consulted once up front" (returns normally after reading both).
export function twoPagesFirstWithoutResourcesPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>');
  b.object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  b.object(5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>');
  b.stream(6, '<< >>', enc(HELLO_CONTENT));
  b.classicXrefAndTrailer(6, '/Root 1 0 R');
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

// /Encrypt present, naming a security handler other than /Standard (this one is the public-key handler, the only other one ISO 32000-1 defines). Nothing derived from a password can open it, so readPdf must say so with a clear PdfEncryptedError rather than a generic parse failure -- distinct from a /Standard-handler file that merely needs a password, which src/test-support/encrypted-pdfs.ts covers with real qpdf-encrypted bytes.
export function unsupportedSecurityHandlerPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5);
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.object(6, '<< /Filter /Adobe.PubSec /SubFilter /adbe.pkcs7.s5 /V 4 /R 4 >>');
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

// A /MediaBox whose origin isn't (0,0) -- our own writer never produces one (see write.ts's own module doc), but real producers occasionally do; placement must be computed relative to the MediaBox's own origin, not assumed to be (0,0). The text sits at (60, 60), inside the box, so it survives the crop-box visibility filter (the box IS the visible region even without a declared /CropBox).
export function nonZeroOriginMediaBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.4');
  catalogPagesPageFontObjects(b, 5, '[50 50 250 150]');
  b.stream(5, '<< >>', enc('BT /F1 12 Tf 60 60 Td (Hello) Tj ET'));
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

// A two-page document exercising the whole navigation cluster (#721's core): named destinations from BOTH the old-style catalog /Dests dictionary and a /Names /Dests name tree with a real /Kids split, a two-level document outline, and all three internal-link spellings on page 1 -- a /Dest naming a name-tree destination, a /Dest carrying a direct destination array, and a /A /GoTo action naming an old-style /Dests entry. Page 2 exists so pageIndex resolution is real, not a constant 0.
export function navigationClusterPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R /Dests 9 0 R /Names << /Dests 10 0 R >> /Outlines 11 0 R >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [7 0 R 8 0 R 16 0 R] >>');
  b.object(4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>');
  b.object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  b.stream(6, '<< >>', enc(HELLO_CONTENT));
  b.object(7, '<< /Type /Annot /Subtype /Link /Rect [10 10 60 24] /Dest (second) >>');
  b.object(8, '<< /Type /Annot /Subtype /Link /Rect [70 10 120 24] /Dest [4 0 R /XYZ 20 60 null] >>');
  b.object(9, '<< /firstpage [3 0 R /XYZ 10 80 1.5] >>');
  b.object(10, '<< /Kids [12 0 R] >>');
  b.object(11, '<< /Type /Outlines /First 13 0 R /Last 14 0 R /Count 2 >>');
  b.object(12, '<< /Names [(second) [4 0 R /Fit]] >>');
  b.object(13, '<< /Title (First heading) /Parent 11 0 R /Dest (firstpage) /Next 14 0 R >>');
  b.object(14, '<< /Title (Second page) /Parent 11 0 R /Dest [4 0 R /XYZ null null null] /Prev 13 0 R /First 15 0 R /Last 15 0 R /Count 1 >>');
  b.object(15, '<< /Title (Nested child) /Parent 14 0 R /Dest (second) >>');
  b.object(16, '<< /Type /Annot /Subtype /Link /Rect [10 30 60 44] /Contents (Internal note) /A << /S /GoTo /D (firstpage) >> >>');
  b.classicXrefAndTrailer(16, '/Root 1 0 R');
  return b.bytes();
}

// The embedded-files cluster (#721 phase 2): a /Names /EmbeddedFiles name-tree entry whose stream carries /Subtype and whose filespec carries /Desc; a /FileAttachment annotation on the page with its own filespec plus a SECOND annotation whose filespec duplicates the name-tree entry's name (the dedup case); and a catalog /AF associated-files entry (ISO 32000-2). One of the streams is Flate-compressed so decoding goes through the ordinary filter path, and one is raw binary bytes with no /Subtype, pinning that mimeType is absent rather than guessed.
export function embeddedFilesPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 6 0 R >> /AF [13 0 R] >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [10 0 R 11 0 R] >>');
  b.object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  // The name tree root, split through a /Kids node so the walker's recursion is exercised here too.
  b.object(6, '<< /Kids [7 0 R] >>');
  b.object(7, '<< /Names [(notes.txt) 8 0 R] >>');
  b.object(8, '<< /Type /Filespec /F (notes.txt) /UF (notes.txt) /Desc (Meeting notes) /EF << /F 9 0 R >> >>');
  b.stream(9, '<< /Type /EmbeddedFile /Subtype /text#2Fplain >>', enc('Attached file body'));
  // A /FileAttachment annotation with a distinct filespec, and a second whose filespec repeats the name-tree entry's name -- the second must collapse into the first-Seen entry, not duplicate it.
  b.object(10, '<< /Type /Annot /Subtype /FileAttachment /Rect [150 80 170 96] /FS 12 0 R >>');
  b.object(11, '<< /Type /Annot /Subtype /FileAttachment /Rect [150 60 170 76] /FS 8 0 R >>');
  b.object(12, '<< /Type /Filespec /F (logo.bin) /EF << /F 14 0 R >> >>');
  b.object(13, '<< /Type /Filespec /F (manifest.json) /UF (manifest.json) /EF << /F 15 0 R >> >>');
  b.stream(14, '<< /Type /EmbeddedFile /Params << /Size 3 >> >>', new Uint8Array([0, 1, 2]));
  // Flate-compressed so the bytes recover through the ordinary filter path, not just raw passthrough.
  b.stream(15, '<< /Type /EmbeddedFile /Filter /FlateDecode >>', zlibSync(enc('{}')));
  b.classicXrefAndTrailer(15, '/Root 1 0 R');
  return b.bytes();
}

// The optional-content cluster (#721 phase 3): two OCGs with the default configuration switching one OFF, a /OC BDC span in the named-property-list form, one in the inline-dict form carrying /ActualText, and two form XObjects -- one inheriting the outer span's layer, one declaring its own /OC (which wins for its items).
export function ocgPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R 7 0 R] /D << /BaseState /ON /OFF [6 0 R] >> >> >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> /Properties << /L1 << /OC 6 0 R >> >> /XObject << /Fm1 8 0 R /Fm2 9 0 R >> >> /Contents 5 0 R >>');
  b.object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  b.stream(
    5,
    '<< >>',
    enc([
      'BT /F1 12 Tf 10 180 Td (Visible text) Tj ET',
      '/OC /L1 BDC',
      'BT /F1 12 Tf 10 150 Td (Hidden layer text) Tj ET',
      '/Fm1 Do',
      'EMC',
      '/Span << /OC 7 0 R /ActualText (Replacement reading) >> BDC',
      'BT /F1 12 Tf 10 120 Td (Annotated text) Tj ET',
      'EMC',
      '/Fm2 Do',
    ].join('\n')),
  );
  b.object(6, '<< /Type /OCG /Name (Background) >>');
  b.object(7, '<< /Type /OCG /Name (Notes) >>');
  b.stream(8, '<< /Type /XObject /Subtype /Form /BBox [0 0 200 40] /Resources << /Font << /F1 4 0 R >> >> >>', enc('BT /F1 12 Tf 10 20 Td (Form text) Tj ET'));
  b.stream(9, '<< /Type /XObject /Subtype /Form /OC 7 0 R /BBox [0 0 200 40] /Resources << /Font << /F1 4 0 R >> >> >>', enc('BT /F1 12 Tf 10 20 Td (Owned form text) Tj ET'));
  b.classicXrefAndTrailer(9, '/Root 1 0 R');
  return b.bytes();
}

// The annotation cluster (#721 phase 4): a genuine third-party sticky note (a /T that is not this package's own presenter-notes marker), a FreeText, a Highlight carrying /QuadPoints, and a Stamp -- the opaque kind whose facts ride the quarantined residue channel. Page 2 carries no annotations at all, pinning that the page field is absent rather than an empty array.
export function annotationsPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [7 0 R 8 0 R 9 0 R 10 0 R] >>');
  b.object(4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>');
  b.object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  b.stream(6, '<< >>', enc(HELLO_CONTENT));
  b.object(7, '<< /Type /Annot /Subtype /Text /Rect [10 60 26 76] /Contents (A real reviewer note) /T (Reviewer) /M (D:20260819140300Z) >>');
  b.object(8, '<< /Type /Annot /Subtype /FreeText /Rect [40 60 140 80] /Contents (Typed remark) /T (Reviewer) >>');
  b.object(9, '<< /Type /Annot /Subtype /Highlight /Rect [12 30 60 42] /Contents (Marked passage) /T (Second reviewer) /QuadPoints [12 42 60 42 60 30 12 30] >>');
  b.object(10, '<< /Type /Annot /Subtype /Stamp /Rect [100 20 140 40] /Contents (Approved) /T (Reviewer) /Name /Approved >>');
  b.classicXrefAndTrailer(10, '/Root 1 0 R');
  return b.bytes();
}

// The AcroForm cluster (#721 phase 5): a merged text field (its own /Rect, no widget kids) with /V, /TU, and the ReadOnly /Ff bit; a non-terminal group field whose two children exercise the combo flag on /FT /Ch (with /Opt and a /V) and a checkbox whose /V names an export value other than Off; and a signature field. The widget kids appear in the page's /Annots too, pinning that the Widget walk is owned by the field tree rather than duplicating as an annotation record.
export function acroFormPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R 7 0 R 12 0 R] >> >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R 10 0 R 11 0 R 13 0 R] >>');
  b.object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.object(6, '<< /Type /Annot /Subtype /Widget /FT /Tx /T (fullname) /V (Jane Doe) /TU (Full name) /Ff 1 /Rect [10 80 110 96] /P 3 0 R >>');
  b.object(7, '<< /T (contact) /Kids [8 0 R 9 0 R] >>');
  b.object(8, '<< /FT /Ch /Ff 131072 /T (country) /Opt [(UK) (US)] /V (UK) /Kids [10 0 R] >>');
  b.object(9, '<< /FT /Btn /T (subscribe) /V /Yes /Kids [11 0 R] >>');
  b.object(10, '<< /Type /Annot /Subtype /Widget /Rect [10 60 110 74] /P 3 0 R /Parent 8 0 R >>');
  b.object(11, '<< /Type /Annot /Subtype /Widget /Rect [10 40 22 52] /P 3 0 R /Parent 9 0 R >>');
  b.object(12, '<< /FT /Sig /T (sig) /TU (Approver signature) /Kids [13 0 R] >>');
  b.object(13, '<< /Type /Annot /Subtype /Widget /Rect [150 20 190 40] /P 3 0 R /Parent 12 0 R >>');
  b.classicXrefAndTrailer(13, '/Root 1 0 R');
  return b.bytes();
}

// The metadata/residue cluster (#721 phase 6): catalog /Lang, an XMP /Metadata stream whose Dublin Core fields partially overlap an /Info dict (pinning that /Info wins and XMP fills only the gaps, the PDF/A shape), and the residue rows -- /ViewerPreferences, /PageMode, /OutputIntents, and the trailer /ID.
export function metadataResiduePdf(): Uint8Array<ArrayBuffer> {
  const xmp = [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">From XMP</rdf:li></rdf:Alt></dc:title>',
    '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">The XMP description</rdf:li></rdf:Alt></dc:description>',
    '<dc:subject><rdf:Bag><rdf:li>xmp</rdf:li><rdf:li>metadata</rdf:li></rdf:Bag></dc:subject>',
    '<dc:creator><rdf:Seq><rdf:li>XMP Author</rdf:li></rdf:Seq></dc:creator>',
    '<pdf:Producer>XMP Producer 9.9</pdf:Producer>',
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
  const b = new FixtureBuilder().header('1.7');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R /Lang (en-GB) /Metadata 6 0 R /ViewerPreferences << /HideToolbar true >> /PageMode /UseOutlines /OutputIntents [7 0 R] >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  b.object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.stream(6, '<< /Type /Metadata /Subtype /XML >>', enc(xmp));
  b.object(7, '<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) >>');
  b.object(8, '<< /Title (From Info) >>');
  b.classicXrefAndTrailer(8, '/Root 1 0 R /Info 8 0 R /ID [<0a1b2c3d4e5f60718293a4b5c6d7e8f9> <0a1b2c3d4e5f60718293a4b5c6d7e8f9>]');
  return b.bytes();
}

// --- Page boundaries (#759): /CropBox as the visible region, and the print-production boxes with no model home. ---

// MediaBox [0 0 200 100] with CropBox [100 0 200 50] -- the right half's lower band is the only visible region. Three paint operations: text wholly inside the crop, text wholly in the cropped-away left half, and a rect straddling the crop's right edge (x 190..210 against the boundary at 200). A viewer shows the inside text in full, the straddling rect clipped at x=200, and nothing of the outside text. A URI link annotation in the cropped-away half rides along: an annotation is an anchored construct, not painted stream content, so the visibility filter must not claim it.
export function cropBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  catalogPagesPageFontObjects(
    b,
    5,
    '[0 0 200 100]',
    '/CropBox [100 0 200 50] /Annots [6 0 R] ',
  );
  b.stream(5, '<< >>', enc('BT /F1 12 Tf 120 20 Td (inside) Tj ET BT /F1 12 Tf 10 80 Td (outside) Tj ET 190 20 20 10 re f'));
  b.object(6, '<< /Type /Annot /Subtype /Link /Rect [10 70 60 84] /A << /S /URI /URI (https://example.com/marks) >> >>');
  b.classicXrefAndTrailer(6, '/Root 1 0 R');
  return b.bytes();
}

// The same geometry with /Rotate 90 -- the crop rect must land origin-normalised in the rotated frame too (the rotated crop spans x 0..50, y 0..100, so the page reports 50x100, the inside text at (120, 20) lands at (20, 80), and the straddling rect crosses the rotated boundary at y=0).
export function rotatedCropBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  catalogPagesPageFontObjects(
    b,
    5,
    '[0 0 200 100]',
    '/CropBox [100 0 200 50] /Rotate 90 ',
  );
  b.stream(5, '<< >>', enc('BT /F1 12 Tf 120 20 Td (inside) Tj ET BT /F1 12 Tf 10 80 Td (outside) Tj ET 190 20 20 10 re f'));
  b.classicXrefAndTrailer(5, '/Root 1 0 R');
  return b.bytes();
}

// CropBox declared on the PARENT Pages node -- it is one of the four page-tree-inheritable attributes (ISO 32000-1 7.7.3.4), so a page with no /CropBox of its own inherits the bottom band [0 0 200 50].
export function inheritedCropBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  b.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  b.object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /CropBox [0 0 200 50] >>');
  b.object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  b.object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  b.stream(5, '<< >>', enc('BT /F1 12 Tf 10 20 Td (inside) Tj ET BT /F1 12 Tf 10 80 Td (outside) Tj ET'));
  b.classicXrefAndTrailer(5, '/Root 1 0 R');
  return b.bytes();
}

// MediaBox with an EQUAL CropBox plus the three print-production boxes declared page-direct (ISO 32000-1 Table 30 lists /BleedBox /TrimBox /ArtBox as ordinary per-page entries, not inheritable ones): nothing is cropped away, but the declared boxes are facts beyond the visible box that the model has no field for.
export function printBoxesPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  catalogPagesPageFontObjects(
    b,
    5,
    '[0 0 200 100]',
    '/CropBox [0 0 200 100] /BleedBox [0 0 210 110] /TrimBox [5 5 195 95] /ArtBox [10 10 190 90] ',
  );
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.classicXrefAndTrailer(5, '/Root 1 0 R');
  return b.bytes();
}

// MediaBox with an EQUAL CropBox and nothing else -- the degenerate declaration a producer sometimes writes. Nothing is cropped away, and a crop box that IS the media box carries no fact beyond the visible one, so this page contributes no residue row.
export function equalCropBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header('1.7');
  catalogPagesPageFontObjects(
    b,
    5,
    '[0 0 200 100]',
    '/CropBox [0 0 200 100] ',
  );
  b.stream(5, '<< >>', enc(HELLO_CONTENT));
  b.classicXrefAndTrailer(5, '/Root 1 0 R');
  return b.bytes();
}
