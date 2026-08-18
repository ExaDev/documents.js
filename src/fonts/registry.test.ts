import { describe, expect, it } from 'vitest';
import type { EmbeddedFaceSubstitution, FontSubstitution, LayoutDocument, ProvidedFont } from 'pdf-codec';
import { LAYOUT_FORMAT_VERSION, writePdf } from 'pdf-codec';
import { minimalDocxPackage } from '../test-support/docx';
import { caladeaItalicBytes, embeddedFontDocxPackage, embeddedFontOdtPackage, embeddedFontPptxPackage } from '../test-support/fonts';
import { createDocumentFontRegistry, extractSourceFonts } from './registry';

// A character no Latin-only face carries -- Caladea's cmap genuinely has no glyph for CJK, so a run containing this is the honest "the embedded face is right for the document but lacks this one synthesised character" case.
const UNMAPPED_CHARACTER = '中';

function textPage(text: string, family: string): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    pages: [
      {
        widthPt: 595,
        heightPt: 842,
        items: [{ kind: 'text', text, xPt: 72, yPt: 700, font: { family, weight: 'normal', style: 'normal' }, sizePt: 12, color: { r: 0, g: 0, b: 0 } }],
      },
    ],
    images: {},
  };
}

function providedFont(family: string, bold: boolean, italic: boolean, bytes: Uint8Array<ArrayBuffer>): ProvidedFont {
  return { family, bold, italic, bytes };
}

describe('extractSourceFonts', () => {
  it('routes a docx package to the OOXML extractor', () => {
    expect(extractSourceFonts({ kind: 'docx', package: embeddedFontDocxPackage() }).map((font) => `${font.family}/${String(font.bold)}/${String(font.italic)}`)).toEqual([
      'Caladea/false/false',
      'Caladea/true/false',
    ]);
  });

  it('routes a pptx package to the OOXML extractor', () => {
    expect(extractSourceFonts({ kind: 'pptx', package: embeddedFontPptxPackage() }).map((font) => `${font.family}/${String(font.bold)}/${String(font.italic)}`)).toEqual([
      'Caladea/false/false',
      'Caladea/false/true',
    ]);
  });

  it('routes an ODF package to the ODF extractor', () => {
    expect(extractSourceFonts({ kind: 'odf', package: embeddedFontOdtPackage() }).map((font) => `${font.family}/${String(font.bold)}/${String(font.italic)}`)).toEqual([
      'Caladea/false/false',
      'Caladea/true/false',
    ]);
  });
});

describe('createDocumentFontRegistry', () => {
  it('resolves a family the source package embedded to the embedded face itself', () => {
    const registry = createDocumentFontRegistry({ kind: 'docx', package: embeddedFontDocxPackage() });
    const resolved = registry.resolve({ family: 'Caladea', weight: 'normal', style: 'normal' });
    expect(resolved.kind).toBe('embedded');
    expect(resolved.kind === 'embedded' ? resolved.face.postScriptName : undefined).toBe('Caladea-Regular');
  });

  it('resolves each embedded face separately by weight', () => {
    const registry = createDocumentFontRegistry({ kind: 'docx', package: embeddedFontDocxPackage() });
    const bold = registry.resolve({ family: 'Caladea', weight: 'bold', style: 'normal' });
    expect(bold.kind === 'embedded' ? bold.face.postScriptName : undefined).toBe('Caladea-Bold');
  });

  // The precedence this whole module exists to express: the document's own embedded bytes win over anything the caller supplies for the same family+weight+style.
  it('prefers the source package own face over a caller-supplied face for the same slot', () => {
    const registry = createDocumentFontRegistry({ kind: 'docx', package: embeddedFontDocxPackage() }, { fonts: [providedFont('Caladea', false, false, caladeaItalicBytes())] });
    const resolved = registry.resolve({ family: 'Caladea', weight: 'normal', style: 'normal' });
    expect(resolved.kind === 'embedded' ? resolved.face.postScriptName : undefined).toBe('Caladea-Regular');
  });

  // ...and the caller's faces still fill slots the source package never embedded.
  it('falls back to a caller-supplied face for a family the source package did not embed', () => {
    const registry = createDocumentFontRegistry({ kind: 'docx', package: embeddedFontDocxPackage() }, { fonts: [providedFont('Bookish', false, true, caladeaItalicBytes())] });
    const resolved = registry.resolve({ family: 'Bookish', weight: 'normal', style: 'italic' });
    expect(resolved.kind === 'embedded' ? resolved.face.postScriptName : undefined).toBe('Caladea-Italic');
  });

  // A package that embeds nothing must still produce a usable registry rather than an error -- that is the ordinary case for a document saved without font embedding.
  it('produces a working registry for a package that embeds no fonts at all', () => {
    const registry = createDocumentFontRegistry({ kind: 'docx', package: minimalDocxPackage() });
    expect(registry.resolve({ family: 'Helvetica', weight: 'normal', style: 'normal' })).toEqual({ kind: 'standard', standardName: 'Helvetica', matched: true });
  });

  it('reports a face-level fallback through onFontSubstitution', () => {
    const substitutions: FontSubstitution[] = [];
    const registry = createDocumentFontRegistry({ kind: 'docx', package: embeddedFontDocxPackage() }, { onFontSubstitution: (substitution) => substitutions.push(substitution) });
    registry.resolve({ family: 'Caladea', weight: 'normal', style: 'italic' });
    expect(substitutions).toEqual([{ requestedFamily: 'Caladea', requestedBold: false, requestedItalic: true, reason: 'missing-face', resolvedFamily: 'Caladea' }]);
  });

  // A registry built from an ODF package must be interchangeable with one built from an OOXML package -- same resolution, different extractor.
  it('resolves an ODF-sourced face identically to its OOXML-sourced equivalent', () => {
    const odf = createDocumentFontRegistry({ kind: 'odf', package: embeddedFontOdtPackage() }).resolve({ family: 'Caladea', weight: 'bold', style: 'normal' });
    const ooxml = createDocumentFontRegistry({ kind: 'docx', package: embeddedFontDocxPackage() }).resolve({ family: 'Caladea', weight: 'bold', style: 'normal' });
    expect(odf.kind === 'embedded' ? odf.face.postScriptName : undefined).toBe('Caladea-Bold');
    expect(ooxml.kind === 'embedded' ? ooxml.face.postScriptName : undefined).toBe('Caladea-Bold');
  });
});

// The requirement an embedded, SUBSETTED source face makes unavoidable: a character the source document never contained (a list bullet this package synthesises, sheets.ts's own ### overflow marker) may legitimately be missing from an otherwise-correct face. That must degrade for the one character, not for the run and not for the document.
describe('a cmap miss on a source-embedded face', () => {
  it('reports per character and still writes a PDF', () => {
    const missing: EmbeddedFaceSubstitution[] = [];
    const bytes = writePdf(textPage(`before ${UNMAPPED_CHARACTER} after`, 'Caladea'), {
      fonts: createDocumentFontRegistry({ kind: 'docx', package: embeddedFontDocxPackage() }),
      onMissingGlyph: (substitution) => missing.push(substitution),
    });
    expect(missing).toEqual([{ from: UNMAPPED_CHARACTER }]);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('reports nothing for a run the embedded face covers completely', () => {
    const missing: EmbeddedFaceSubstitution[] = [];
    writePdf(textPage('every character here is covered', 'Caladea'), {
      fonts: createDocumentFontRegistry({ kind: 'docx', package: embeddedFontDocxPackage() }),
      onMissingGlyph: (substitution) => missing.push(substitution),
    });
    expect(missing).toEqual([]);
  });

  it('does not throw when no onMissingGlyph callback is supplied at all', () => {
    expect(() =>
      writePdf(textPage(UNMAPPED_CHARACTER, 'Caladea'), { fonts: createDocumentFontRegistry({ kind: 'odf', package: embeddedFontOdtPackage() }) }),
    ).not.toThrow();
  });

  it('still embeds the real source face rather than falling back to a substitute for the whole run', () => {
    const registry = createDocumentFontRegistry({ kind: 'docx', package: embeddedFontDocxPackage() });
    const resolved = registry.resolve({ family: 'Caladea', weight: 'normal', style: 'normal' });
    expect(resolved.kind === 'embedded' ? resolved.face.glyphId(UNMAPPED_CHARACTER.codePointAt(0) ?? 0) : 0).toBeUndefined();
    expect(resolved.kind === 'embedded' ? resolved.face.glyphId('A'.codePointAt(0) ?? 0) : undefined).toBeGreaterThan(0);
  });
});
