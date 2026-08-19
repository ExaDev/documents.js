import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  brokenStartxrefPdf,
  formXObjectPdf,
  incrementalUpdatePdf,
  inheritedPageAttributesPdf,
  inlineImagePdf,
  minimalClassicXrefPdf,
  nonZeroOriginMediaBoxPdf,
  rotatedPagePdf,
  unsupportedSecurityHandlerPdf,
  withInfoDictPdf,
  xrefStreamWithObjectStreamPdf,
} from './pdf';

function decode(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function expectWellFormedHeaderAndTrailer(bytes: Uint8Array): string {
  const text = decode(bytes);
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  return text;
}

// Verifies every in-use entry in a SINGLE, full (0..N) classic xref section points at that object's own "N 0 obj" header -- the same style of check write.test.ts already applies to our own writer's output, applied here to hand-built fixtures instead.
function verifyFullClassicXref(bytes: Uint8Array): void {
  const text = decode(bytes);
  const xrefIdx = text.lastIndexOf('\nxref\n') + 1;
  const trailerIdx = text.indexOf('trailer', xrefIdx);
  const lines = text
    .slice(xrefIdx, trailerIdx)
    .split('\n')
    .filter((l) => l.length > 0);
  const entryLines = lines.slice(2); // skip 'xref' and the '0 N' subsection header
  entryLines.forEach((line, objNum) => {
    const match = /^(\d{10}) (\d{5}) ([nf]) $/.exec(line);
    expect(match).not.toBeNull();
    const [, offsetStr, , type] = match!;
    if (type === 'f') {
      return;
    }
    const offset = Number(offsetStr);
    expect(text.slice(offset, offset + `${objNum} 0 obj`.length)).toBe(`${objNum} 0 obj`);
  });
}

describe('minimalClassicXrefPdf', () => {
  it('is well-formed and its xref offsets are correct', () => {
    const bytes = minimalClassicXrefPdf();
    expectWellFormedHeaderAndTrailer(bytes);
    verifyFullClassicXref(bytes);
  });

  it('uses a literal (parenthesized) content-stream string, not a hex string', () => {
    const text = decode(minimalClassicXrefPdf());
    expect(text).toContain('(Hello) Tj');
  });
});

describe('xrefStreamWithObjectStreamPdf', () => {
  it('is well-formed, with startxref pointing at the xref stream\'s own header', () => {
    const bytes = xrefStreamWithObjectStreamPdf();
    const text = expectWellFormedHeaderAndTrailer(bytes);
    const match = /startxref\n(\d+)\n%%EOF$/.exec(text);
    expect(match).not.toBeNull();
    const offset = Number(match![1]);
    expect(text.slice(offset, offset + '6 0 obj'.length)).toBe('6 0 obj');
  });

  it('packs the Catalog/Pages/Page into a decodable object stream', () => {
    const bytes = xrefStreamWithObjectStreamPdf();
    const text = decode(bytes);
    const objStmStart = text.indexOf('4 0 obj');
    const streamStart = text.indexOf('stream\n', objStmStart) + 'stream\n'.length;
    const streamEnd = text.indexOf('\nendstream', streamStart);
    const decoded = new TextDecoder().decode(unzlibSync(bytes.subarray(streamStart, streamEnd)));
    expect(decoded).toContain('/Type /Catalog');
    expect(decoded).toContain('/Type /Pages');
    expect(decoded).toContain('/Type /Page');
    expect(decoded.startsWith('1 0 2 ')).toBe(true); // the ObjStm's own "objNum offset" header
  });

  it('every top-level object\'s xref-stream row points at its real byte offset', () => {
    const bytes = xrefStreamWithObjectStreamPdf();
    const text = decode(bytes);
    const xrefObjStart = text.indexOf('6 0 obj');
    const streamStart = text.indexOf('stream\n', xrefObjStart) + 'stream\n'.length;
    const streamEnd = text.indexOf('\nendstream', streamStart);
    const rows = unzlibSync(bytes.subarray(streamStart, streamEnd));
    expect(rows.length % 7).toBe(0);
    for (const objNum of [4, 5, 6]) {
      const base = objNum * 7;
      expect(rows[base]).toBe(1); // type 1: uncompressed, byte offset
      const offset = ((rows[base + 1]! << 24) | (rows[base + 2]! << 16) | (rows[base + 3]! << 8) | rows[base + 4]!) >>> 0;
      expect(text.slice(offset, offset + `${objNum} 0 obj`.length)).toBe(`${objNum} 0 obj`);
    }
    // Compressed rows (1, 2, 3) all point at ObjStm object 4.
    for (const objNum of [1, 2, 3]) {
      const base = objNum * 7;
      expect(rows[base]).toBe(2);
      const objStmNum = ((rows[base + 1]! << 24) | (rows[base + 2]! << 16) | (rows[base + 3]! << 8) | rows[base + 4]!) >>> 0;
      expect(objStmNum).toBe(4);
    }
  });
});

describe('brokenStartxrefPdf', () => {
  it('is well-formed at the object level but startxref points nowhere useful', () => {
    const bytes = brokenStartxrefPdf();
    const text = expectWellFormedHeaderAndTrailer(bytes);
    const match = /startxref\n(\d+)\n%%EOF$/.exec(text);
    expect(Number(match![1])).toBe(999999);
    expect(bytes.length).toBeLessThan(999999);
  });

  it('still contains every real object, recoverable by a linear "N 0 obj" scan', () => {
    const text = decode(brokenStartxrefPdf());
    for (let n = 1; n <= 5; n++) {
      expect(text).toContain(`${n} 0 obj`);
    }
  });
});

describe('incrementalUpdatePdf', () => {
  it('chains a second xref section to the first via /Prev, at the first section\'s real offset', () => {
    const text = decode(incrementalUpdatePdf());
    const secondXrefIdx = text.indexOf('xref\n3 1\n');
    expect(secondXrefIdx).toBeGreaterThan(-1);
    const secondTrailerIdx = text.indexOf('trailer', secondXrefIdx);
    const prevMatch = /\/Prev (\d+)/.exec(text.slice(secondTrailerIdx));
    expect(prevMatch).not.toBeNull();
    const prevOffset = Number(prevMatch![1]);
    expect(text.slice(prevOffset, prevOffset + 'xref\n0 6'.length)).toBe('xref\n0 6');
  });

  it('the second revision\'s object 3 redefines the page with a different MediaBox, at the offset the second xref section records', () => {
    const text = decode(incrementalUpdatePdf());
    const secondXrefIdx = text.indexOf('xref\n3 1\n');
    const entryMatch = /(\d{10}) 00000 n/.exec(text.slice(secondXrefIdx));
    const offset = Number(entryMatch![1]);
    const body = text.slice(offset, offset + 120);
    expect(body).toContain('3 0 obj');
    expect(body).toContain('[0 0 400 300]');
  });

  it('the first revision\'s own object 3 (superseded) is still physically present, with the original MediaBox', () => {
    const text = decode(incrementalUpdatePdf());
    const firstObj3Idx = text.indexOf('3 0 obj');
    expect(text.slice(firstObj3Idx, firstObj3Idx + 120)).toContain('[0 0 200 100]');
  });
});

describe('unsupportedSecurityHandlerPdf', () => {
  it('is well-formed and its trailer references an /Encrypt dictionary naming a non-standard handler', () => {
    const bytes = unsupportedSecurityHandlerPdf();
    expectWellFormedHeaderAndTrailer(bytes);
    verifyFullClassicXref(bytes);
    const text = decode(bytes);
    expect(text).toMatch(/trailer\n<<[^>]*\/Encrypt 6 0 R/);
    expect(text).toContain('/Filter /Adobe.PubSec');
    expect(text).not.toContain('/Filter /Standard');
  });
});

describe('rotatedPagePdf', () => {
  it('sets /Rotate 90 on the page dict', () => {
    const bytes = rotatedPagePdf();
    verifyFullClassicXref(bytes);
    expect(decode(bytes)).toContain('/Rotate 90');
  });
});

describe('nonZeroOriginMediaBoxPdf', () => {
  it('sets a MediaBox whose origin is not (0,0)', () => {
    const bytes = nonZeroOriginMediaBoxPdf();
    verifyFullClassicXref(bytes);
    expect(decode(bytes)).toContain('/MediaBox [50 50 250 150]');
  });
});

describe('formXObjectPdf', () => {
  it('references a /Subtype /Form XObject from the page content, with its own resources', () => {
    const bytes = formXObjectPdf();
    verifyFullClassicXref(bytes);
    const text = decode(bytes);
    expect(text).toContain('/Fm1 Do');
    expect(text).toContain('/Subtype /Form');
    expect(text).toContain('In a form');
  });
});

describe('inheritedPageAttributesPdf', () => {
  it('puts /MediaBox and /Resources on the Pages node, not either Page', () => {
    const bytes = inheritedPageAttributesPdf();
    verifyFullClassicXref(bytes);
    const text = decode(bytes);
    const pagesObj = text.slice(text.indexOf('2 0 obj'), text.indexOf('endobj', text.indexOf('2 0 obj')));
    expect(pagesObj).toContain('/MediaBox [0 0 300 200]');
    expect(pagesObj).toContain('/Resources');
    const firstPageObj = text.slice(text.indexOf('3 0 obj'), text.indexOf('endobj', text.indexOf('3 0 obj')));
    expect(firstPageObj).not.toContain('/MediaBox');
    expect(firstPageObj).not.toContain('/Resources');
  });

  it('sets /Rotate directly on only the second page', () => {
    const text = decode(inheritedPageAttributesPdf());
    const secondPageObj = text.slice(text.indexOf('4 0 obj'), text.indexOf('endobj', text.indexOf('4 0 obj')));
    expect(secondPageObj).toContain('/Rotate 90');
  });
});

describe('withInfoDictPdf', () => {
  it('encodes /Title as UTF-16BE with a leading BOM', () => {
    const text = decode(withInfoDictPdf());
    expect(text).toContain('/Title <feff');
  });

  it('encodes /Author and /Keywords as plain literal strings', () => {
    const text = decode(withInfoDictPdf());
    expect(text).toContain('/Author (Jane Smith)');
    expect(text).toContain('/Keywords (alpha, beta)');
  });

  it("encodes /CreationDate in the PDF date format with an explicit offset", () => {
    const text = decode(withInfoDictPdf());
    expect(text).toContain("/CreationDate (D:20240115103000+02'00')");
  });

  it('links the trailer\'s /Info to the dict object', () => {
    const text = decode(withInfoDictPdf());
    expect(text).toMatch(/trailer\n<<[^>]*\/Info 6 0 R/);
  });
});

describe('inlineImagePdf', () => {
  it('uses the BI/ID/EI inline-image form, not an Image XObject', () => {
    const bytes = inlineImagePdf();
    verifyFullClassicXref(bytes);
    const text = decode(bytes);
    expect(text).toContain('BI /W 2 /H 2');
    expect(text).toContain(' ID ');
    expect(text).toContain(' EI Q');
  });
});
