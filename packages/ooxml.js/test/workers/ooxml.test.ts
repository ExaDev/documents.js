import { describe, expect, it } from 'vitest';
import type { Package } from '../../src';
import { buildDocxPackageFromContent, buildXlsxPackage, bytesToBase64, decodePackage, el, encodePackage, flattenPackage, readDocxContent, readPptxContent, readXlsx, readXlsxContent, zipPackage } from '../../src';
import { oleObjectBin } from '../../src/test-support/cfb';
import { minimalXlsxBytes } from '../../src/test-support/embedded';

// Proves ooxml.js's xlsx decode path executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The path under test -- zipPackage (fflate, pure JS) -> decodePackage -> readXlsxContent (fast-xml-parser, pure JS) -- is deliberately Node-free; if any step touched node:fs/Buffer/process the workerd isolate would throw rather than these passing. The minimal xlsx parts are built inline as a Record<string, Uint8Array> (no node:fs/readFileSync -- workerd has no fs) and round-trip through the same zip/decode path src/typed/xlsx.test.ts already exercises under node. This is the runtime proof for ooxml.js issue #17. The second test extends the same proof to the DocumentPackage boundary readXlsx/buildXlsxPackage sit on, since a structural transform is exactly the sort of pure-object code that could quietly acquire a Node dependency without any test noticing under node.
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// A complete minimal xlsx package: the parts every spreadsheet reader needs (root content-types, root rels, workbook, workbook rels, one worksheet). The worksheet carries a single row with a single inline-string cell (t="inlineStr") so no shared-strings part is required -- the cell's own <is><t> holds its value directly.
function minimalXlsxParts(): Record<string, Uint8Array> {
  return {
    '[Content_Types].xml': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    '_rels/.rels': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello from workerd</t></is></c></row></sheetData></worksheet>',
    ),
  };
}

describe('ooxml.js xlsx decode and package assembly under the Cloudflare Workers runtime', () => {
  it('decodes a minimal xlsx built inline and reads it back as a spreadsheet content document', () => {
    // zipPackage (fflate) -> decodePackage -> readXlsxContent: the full decode path src/typed/xlsx.test.ts exercises under node, now running inside a workerd isolate. No Node Buffer, no fs, no process.
    const bytes = zipPackage(minimalXlsxParts());
    const pkg = decodePackage(bytes);
    const document = readXlsxContent(pkg);

    expect(document.kind).toBe('spreadsheet');
    expect(document.sheets).toHaveLength(1);
    expect(document.sheets[0]?.name).toBe('Sheet1');
    // ContentSheet.cells is a flat array indexed by position, each carrying its own row/column indices -- the inline-string cell at A1 reads as a string ContentCellValue at row 0, column 0.
    const cell = document.sheets[0]?.cells[0];
    expect(cell?.row).toBe(0);
    expect(cell?.column).toBe(0);
    expect(cell?.value).toEqual({ kind: 'string', value: 'Hello from workerd' });
  });

  it('assembles and writes the tree-form DocumentPackage inside the isolate too', () => {
    // The DocumentPackage boundary (document-schema.js's decompose/factorStyles on the way out, flattenPackage on the way back in) is pure structural transformation over plain objects, so it belongs on the Worker-isomorphic side of this package exactly as the codecs do -- asserted rather than assumed, since the whole point of this suite is that nothing in the published path quietly reaches for a Node API.
    const pkg = decodePackage(zipPackage(minimalXlsxParts()));
    const document = readXlsx(pkg);

    expect(document.kind).toBe('spreadsheet');
    expect(document.kind === 'spreadsheet' ? document.children[0]?.node.name : undefined).toBe('Sheet1');
    // The tree's inverse, run in the isolate: flattening it back reproduces exactly what the content-level reader returns.
    expect(flattenPackage(document)).toEqual(readXlsxContent(pkg));

    // And the write side, all the way back out to bytes. What survives the pair is src/typed/document-package.test.ts's business, not this suite's -- here the point is only that every step of it executes under workerd, so this asserts the cell rather than the whole package.
    const rewritten = readXlsx(decodePackage(encodePackage(buildXlsxPackage(document))));
    expect(rewritten.kind === 'spreadsheet' ? rewritten.children[0]?.node.cells[0]?.value : undefined).toEqual({ kind: 'string', value: 'Hello from workerd' });
  });
});

describe('ooxml.js pptx OLE embedded-object recovery under the Cloudflare Workers runtime', () => {
  const pptxWithOlePayload = (partPath: string, payloadBytes: Uint8Array<ArrayBuffer>): Package => {
    const choiceOleObj = el('p:oleObj', { spid: '3', 'r:id': 'rIdOle', progId: 'Excel.Sheet.12' }, [el('p:embed')]);
    const oleFrame = el('p:graphicFrame', {}, [
      el('p:nvGraphicFramePr', {}, [el('p:cNvPr', { id: '2', name: 'Object 1' })]),
      el('p:xfrm', {}, [el('a:off', { x: '914400', y: '1828800' }), el('a:ext', { cx: '4572000', cy: '2743200' })]),
      el('a:graphic', {}, [
        el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/presentationml/2006/ole' }, [
          el('mc:AlternateContent', {}, [el('mc:Choice', { Requires: 'v' }, [choiceOleObj])]),
        ]),
      ]),
    ]);
    const slide = el('p:sld', {}, [el('p:cSld', {}, [el('p:spTree', {}, [oleFrame])])]);
    const presentation = el('p:presentation', {}, [el('p:sldIdLst', {}, [el('p:sldId', { id: '256', 'r:id': 'rId1' })])]);
    const relElement = (id: string, type: string, target: string) => el('Relationship', { Id: id, Type: type, Target: target });
    return {
      parts: {
        'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
        'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relElement('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', 'slides/slide1.xml')])] },
        'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide] },
        'ppt/slides/_rels/slide1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relElement('rIdOle', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject', `../embeddings/${partPath}`)])] },
        [`ppt/embeddings/${partPath}`]: { kind: 'binary', base64: bytesToBase64(payloadBytes) },
      },
    };
  };

  it('recovers an OLE-embedded xlsx inside a pptx with no Node-only APIs on the path', () => {
    // The full embedded-object recovery path -- slide relationship resolution -> binary payload part -> archive-codec's isZipArchive -> nested parsePackage -> readXlsxContent -> ContentEmbeddedObjectBlock -- is published runtime src, so it is held to the same Worker-isomorphism contract as the rest of this package. The host pptx is built inline in the Package object model (no fallback picture: the frame's display path is not what this test proves) and its embeddings part carries the same real minimal xlsx bytes the node suites use (src/test-support/embedded.ts), so the nested decode runs over genuine ZIP bytes inside the isolate.
    const doc = readPptxContent(pptxWithOlePayload('oleObject1.xlsx', minimalXlsxBytes()));
    const shape = doc.slides[0]?.shapes[0];
    // No fallback picture, so the frame's blocks are the progId stand-in paragraph plus the recovered embedded object.
    const embedded = shape?.blocks.find((block) => block.kind === 'embeddedObject');
    expect(embedded?.kind === 'embeddedObject' ? embedded.objectKind : undefined).toBe('spreadsheet');
    const sheet = embedded?.kind === 'embeddedObject' && embedded.document.kind === 'spreadsheet' ? embedded.document.sheets[0] : undefined;
    expect(sheet?.cells[0]?.value).toEqual({ kind: 'string', value: 'Recovered cell' });
  });

  it('recovers a classic compound-file .bin payload (an OLE-packaged xlsx) inside the isolate too', () => {
    // The CFB arm of the same recovery -- isCompoundFile -> archive-codec's bounded compound-file reader -> OLE Package unwrapping -> the ZIP path above -- is what makes the whole payload surface Worker-isomorphic, so the .bin spelling gets its own isolate proof rather than inheriting the ZIP one. The mini-stream placement the builder chooses for a payload below the 4096-byte cutoff exercises the mini-FAT walk under workerd as well.
    const doc = readPptxContent(pptxWithOlePayload('oleObject1.bin', oleObjectBin(minimalXlsxBytes())));
    const shape = doc.slides[0]?.shapes[0];
    const embedded = shape?.blocks.find((block) => block.kind === 'embeddedObject');
    expect(embedded?.kind === 'embeddedObject' ? embedded.objectKind : undefined).toBe('spreadsheet');
    const sheet = embedded?.kind === 'embeddedObject' && embedded.document.kind === 'spreadsheet' ? embedded.document.sheets[0] : undefined;
    expect(sheet?.cells[0]?.value).toEqual({ kind: 'string', value: 'Recovered cell' });
  });
});

describe('ooxml.js docx OLE embedded-object recovery under the Cloudflare Workers runtime', () => {
  it('recovers an OLE-embedded xlsx inside a docx with no Node-only APIs on the path', () => {
    // The docx arm of the embedded-object recovery -- document relationship resolution -> binary payload part -> readEmbeddedOoxmlPayload (which cycles back through this reader for a wordprocessing payload) -> ContentEmbeddedObjectBlock lifted beside its paragraph -- adds a new import edge onto the same Worker-isomorphic contract, so it gets its own isolate proof rather than inheriting the pptx one. The host docx is built inline in the Package object model (the VML preview has no reader, so it contributes nothing) and its embeddings part carries the same real minimal xlsx bytes the node suites use.
    const objectParagraph = el('w:p', {}, [
      el('w:r', {}, [
        el('w:object', { 'w:dxaOrig': '1920', 'w:dyaOrig': '1200' }, [
          el('v:shape', { id: '_x0000_i1025', type: '#_x0000_t75' }, [el('v:imagedata', { 'r:id': 'rIdPreview', 'o:title': '' })]),
          el('o:OLEObject', { Type: 'Embed', ProgID: 'Excel.Sheet.12', 'r:id': 'rIdOle' }),
        ]),
      ]),
    ]);
    const body = el('w:body', {}, [objectParagraph, el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '12240', 'w:h': '15840' })])]);
    const relElement = (id: string, type: string, target: string) => el('Relationship', { Id: id, Type: type, Target: target });
    const pkg: Package = {
      parts: {
        'word/document.xml': { kind: 'xml', nodes: [el('w:document', {}, [body])] },
        'word/_rels/document.xml.rels': {
          kind: 'xml',
          nodes: [
            el('Relationships', {}, [
              relElement('rIdOle', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject', 'embeddings/oleObject1.xlsx'),
              relElement('rIdPreview', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', 'media/olePreview.png'),
            ]),
          ],
        },
        'word/embeddings/oleObject1.xlsx': { kind: 'binary', base64: bytesToBase64(minimalXlsxBytes()) },
      },
    };
    const doc = readDocxContent(pkg);
    const embedded = doc.sections[0]?.blocks.find((block) => block.kind === 'embeddedObject');
    expect(embedded?.kind === 'embeddedObject' ? embedded.objectKind : undefined).toBe('spreadsheet');
    const sheet = embedded?.kind === 'embeddedObject' && embedded.document.kind === 'spreadsheet' ? embedded.document.sheets[0] : undefined;
    expect(sheet?.cells[0]?.value).toEqual({ kind: 'string', value: 'Recovered cell' });

    // And the write side of the pair, all the way back out through the nested serialisation: the w:object emitter re-serialises the recovered workbook through buildXlsxPackageFromContent and encodePackage (a second zip, inside the isolate) before the host docx itself is ever assembled -- proving that whole new path is Node-free by executing it here, the same convention the xlsx write-side proof above follows. The re-read recovers the same embedded content from the rewritten package.
    const rewritten = buildDocxPackageFromContent(doc);
    const reEmbedded = readDocxContent(rewritten).sections[0]?.blocks.find((block) => block.kind === 'embeddedObject');
    expect(reEmbedded?.kind === 'embeddedObject' ? reEmbedded.objectKind : undefined).toBe('spreadsheet');
    const reSheet = reEmbedded?.kind === 'embeddedObject' && reEmbedded.document.kind === 'spreadsheet' ? reEmbedded.document.sheets[0] : undefined;
    expect(reSheet?.cells[0]?.value).toEqual({ kind: 'string', value: 'Recovered cell' });
  });
});
