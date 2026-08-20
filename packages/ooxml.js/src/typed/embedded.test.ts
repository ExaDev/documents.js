import { describe, expect, it } from 'vitest';
import { zipPackage } from '../zip';
import { minimalDocxBytes, minimalPptxBytes, minimalXlsxBytes } from '../test-support/embedded';
import { readEmbeddedOoxmlPayload, UnrecognisedOoxmlPackageError } from './embedded';

// Coverage for the shared embedded-object decode (src/typed/embedded.ts): nested-ZIP payload bytes -> flavour detection -> the matching typed reader -> the ContentEmbeddedObject payload (objectKind + a genuinely recovered nested ContentDocument). Fixtures come from src/test-support/embedded.ts -- real minimal OOXML packages zipped inline, because the pipeline under test unzips actual bytes (a hand-built Package value would skip the parse step entirely).

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

describe('readEmbeddedOoxmlPayload', () => {
  it('decodes an embedded xlsx payload into a spreadsheet embedded document', () => {
    const payload = readEmbeddedOoxmlPayload(minimalXlsxBytes());
    expect(payload?.objectKind).toBe('spreadsheet');
    expect(payload?.document.kind).toBe('spreadsheet');
    // The nested document carries the workbook's real content, not just an envelope.
    const sheet = payload?.document.kind === 'spreadsheet' ? payload.document.sheets[0] : undefined;
    expect(sheet?.name).toBe('Embedded');
    expect(sheet?.cells[0]?.value).toEqual({ kind: 'string', value: 'Recovered cell' });
  });

  it('decodes an embedded docx payload into a wordprocessing embedded document', () => {
    const payload = readEmbeddedOoxmlPayload(minimalDocxBytes());
    expect(payload?.objectKind).toBe('wordprocessing');
    expect(payload?.document.kind).toBe('wordprocessing');
    const paragraph = payload?.document.kind === 'wordprocessing' ? payload.document.sections[0]?.blocks[0] : undefined;
    expect(paragraph?.kind).toBe('paragraph');
    expect(paragraph?.kind === 'paragraph' ? paragraph.runs[0]?.text : undefined).toBe('Embedded memo');
  });

  it('decodes an embedded pptx payload into a presentation embedded document', () => {
    const payload = readEmbeddedOoxmlPayload(minimalPptxBytes());
    expect(payload?.objectKind).toBe('presentation');
    expect(payload?.document.kind).toBe('presentation');
    const slide = payload?.document.kind === 'presentation' ? payload.document.slides[0] : undefined;
    expect(slide?.shapes[0]?.blocks[0]?.kind).toBe('paragraph');
  });

  it('returns undefined for a non-ZIP payload (the classic OLE compound file)', () => {
    // The OLE/CFB magic bytes -- the legacy .bin spelling of an embedded object, which no reader in this ecosystem decodes.
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x01, 0x02, 0x03, 0x04]);
    expect(readEmbeddedOoxmlPayload(bytes)).toBeUndefined();
  });

  it('rejects a ZIP that is not a recognisable OOXML package with the named error', () => {
    const bytes = zipPackage({ 'readme.txt': enc('just a file, not a document package') });
    expect(() => readEmbeddedOoxmlPayload(bytes)).toThrow(UnrecognisedOoxmlPackageError);
  });
});
