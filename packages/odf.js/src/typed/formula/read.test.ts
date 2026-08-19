import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { assertPackageRoundTrip, formulaPackage } from '../../test-support/document-package';
import { readOdfFormula, readOdfFormulaContent, readOdfFormulaMathMl } from './read';

// The math root below is copied, element-for-element, from a GENUINE LibreOffice 26.2 .odf's own content.xml -- built via a headless UNO Basic macro (private:factory/smath, Formula set to "f(x) = {x^2} over {2} + sqrt {x}", saved with the "math8" filter) and inspected directly after unzipping the result. It is deliberately NOT hand-simplified: the real fence/stretchy/form attributes on the parenthesis <mo> elements, the nested <mrow> wrapping, and the exact <semantics>/<annotation> shape are all real LibreOffice output, confirming both (a) a bare "math" root tag with a DEFAULT xmlns (not a "math:" prefix -- see read.ts's own top-of-file note) and (b) a real StarMath annotation nested two levels down (<math><semantics><annotation>).
function realFormulaMathRoot(): XmlElement {
  return el('math', { xmlns: 'http://www.w3.org/1998/Math/MathML', display: 'block' }, [
    el('semantics', {}, [
      el('mrow', {}, [
        el('mi', {}, [txt('f')]),
        el('mrow', {}, [
          el('mrow', {}, [
            el('mo', { fence: 'true', form: 'prefix', stretchy: 'false' }, [txt('(')]),
            el('mrow', {}, [el('mi', {}, [txt('x')])]),
            el('mo', { fence: 'true', form: 'postfix', stretchy: 'false' }, [txt(')')]),
          ]),
          el('mo', { stretchy: 'false' }, [txt('=')]),
          el('mrow', {}, [
            el('mfrac', {}, [el('msup', {}, [el('mi', {}, [txt('x')]), el('mn', {}, [txt('2')])]), el('mn', {}, [txt('2')])]),
            el('mo', { stretchy: 'false' }, [txt('+')]),
            el('msqrt', {}, [el('mi', {}, [txt('x')])]),
          ]),
        ]),
      ]),
      el('annotation', { encoding: 'StarMath 5.0' }, [txt('f(x) = {x^2} over {2} + sqrt {x}')]),
    ]),
  ]);
}

function realFormulaPackage(): Package {
  return {
    parts: {
      'content.xml': { kind: 'xml', nodes: [realFormulaMathRoot()] },
      'meta.xml': { kind: 'xml', nodes: [el('office:document-meta', {}, [el('office:meta', {}, [el('dc:title', {}, [txt('Pythagoras')])])])] },
    },
  };
}

describe('readOdfFormulaMathMl', () => {
  it('throws when the package has no content.xml part at all', () => {
    expect(() => readOdfFormulaMathMl({ parts: {} })).toThrow(/content\.xml/);
  });

  it('throws when content.xml is not an XML part', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'binary', base64: '' } } };
    expect(() => readOdfFormulaMathMl(pkg)).toThrow(/content\.xml/);
  });

  it('throws when content.xml has no MathML root anywhere', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(() => readOdfFormulaMathMl(pkg)).toThrow(/MathML/);
  });

  it('reads a genuine LibreOffice-produced formula\'s mathml as the bare "math" root\'s own children, preserving nested fraction/superscript/sqrt structure', () => {
    const { mathml } = readOdfFormulaMathMl(realFormulaPackage());
    expect(mathml).toHaveLength(1);
    const [semantics] = mathml;
    if (semantics?.type !== 'element' || semantics.tag !== 'semantics') {
      throw new Error('expected a semantics element as the sole mathml child');
    }
    // Locate msup (superscript, x^2) and mfrac (fraction) and msqrt (square root) nested inside -- proving real, multi-level MathML structure survives the read, not just a flat single element.
    const json = JSON.stringify(semantics);
    expect(json).toContain('"tag":"msup"');
    expect(json).toContain('"tag":"mfrac"');
    expect(json).toContain('"tag":"msqrt"');
  });

  it('reads the real StarMath annotation text from the standard MathML <annotation encoding="StarMath ..."> element', () => {
    const { starMath } = readOdfFormulaMathMl(realFormulaPackage());
    expect(starMath).toBe('f(x) = {x^2} over {2} + sqrt {x}');
  });

  it('reads metadata via meta.xml, identically to every other odf.js typed reader', () => {
    const { metadata } = readOdfFormulaMathMl(realFormulaPackage());
    expect(metadata.title).toBe('Pythagoras');
  });

  it('returns empty metadata for a package with no meta.xml at all', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [realFormulaMathRoot()] } } };
    expect(readOdfFormulaMathMl(pkg).metadata).toEqual({});
  });

  it('leaves starMath undefined for plain presentation MathML with no semantics/annotation wrapper -- e.g. hand-authored or third-party-produced content.xml, never genuine LibreOffice-Math output (see read.ts\'s own top-of-file note)', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('math', { xmlns: 'http://www.w3.org/1998/Math/MathML' }, [el('mi', {}, [txt('x')])])] } } };
    const result = readOdfFormulaMathMl(pkg);
    expect(result.starMath).toBeUndefined();
    expect('starMath' in result).toBe(false);
    expect(result.mathml).toEqual([el('mi', {}, [txt('x')])]);
  });

  it('ignores an empty <annotation encoding="StarMath ..."> rather than reporting an empty string', () => {
    const pkg: Package = {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [el('math', { xmlns: 'http://www.w3.org/1998/Math/MathML' }, [el('semantics', {}, [el('mi', {}, [txt('x')]), el('annotation', { encoding: 'StarMath 5.0' }, [])])])],
        },
      },
    };
    expect(readOdfFormulaMathMl(pkg).starMath).toBeUndefined();
  });

  it('ignores an <annotation> whose encoding is not StarMath (e.g. a LaTeX annotation)', () => {
    const pkg: Package = {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [
            el('math', { xmlns: 'http://www.w3.org/1998/Math/MathML' }, [
              el('semantics', {}, [el('mi', {}, [txt('x')]), el('annotation', { encoding: 'application/x-tex' }, [txt('x')])]),
            ]),
          ],
        },
      },
    };
    expect(readOdfFormulaMathMl(pkg).starMath).toBeUndefined();
  });

  // Real LibreOffice output -- both a standalone .odf and a Math object embedded inside a real .odt (verified via a headless UNO macro embedding a TextEmbeddedObject with Math's own CLSID) -- never wraps content.xml's math root in office:document-content; see read.ts's own top-of-file note. The two cases below are therefore purely defensive per this reader's own design brief, not verified against any real producer's output.

  it('defensively finds a literal "math:math"-prefixed root at content.xml\'s own top level (never observed in real output, but matches ns.ts\'s own math: prefix convention)', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('math:math', { 'xmlns:math': 'http://www.w3.org/1998/Math/MathML' }, [el('math:mi', {}, [txt('x')])])] } } };
    expect(readOdfFormulaMathMl(pkg).mathml).toEqual([el('math:mi', {}, [txt('x')])]);
  });

  it('defensively finds a bare "math" root nested inside the standard office:document-content wrapper', () => {
    const mathRoot = el('math', { xmlns: 'http://www.w3.org/1998/Math/MathML' }, [el('mi', {}, [txt('y')])]);
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [mathRoot])])] } } };
    expect(readOdfFormulaMathMl(pkg).mathml).toEqual([el('mi', {}, [txt('y')])]);
  });
});

describe('readOdfFormulaContent', () => {
  it('wraps a genuine LibreOffice-produced formula into a real ContentDocument of kind \'formula\', carrying the identical mathml/starMath/metadata readOdfFormulaMathMl itself reads', () => {
    const document = readOdfFormulaContent(realFormulaPackage());
    expect(document.kind).toBe('formula');
    if (document.kind !== 'formula') {
      throw new Error('expected a formula-kind ContentDocument');
    }
    expect(document.metadata.title).toBe('Pythagoras');
    expect(document.formula.starMath).toBe('f(x) = {x^2} over {2} + sqrt {x}');
    expect(document.formula.mathml).toEqual(readOdfFormulaMathMl(realFormulaPackage()).mathml);
  });

  it('omits starMath from the formula field when readOdfFormulaMathMl itself found none', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('math', { xmlns: 'http://www.w3.org/1998/Math/MathML' }, [el('mi', {}, [txt('x')])])] } } };
    const document = readOdfFormulaContent(pkg);
    if (document.kind !== 'formula') {
      throw new Error('expected a formula-kind ContentDocument');
    }
    expect('starMath' in document.formula).toBe(false);
  });

  it('throws the identical readOdfFormulaMathMl error for a package with no MathML root, since it is built directly on readOdfFormulaMathMl', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(() => readOdfFormulaContent(pkg)).toThrow(/MathML/);
  });
});

describe('readOdfFormula: the package-native reader over the same fixture', () => {
  it('assembles the real LibreOffice formula package into a formula-kind DocumentPackage that flattens back exactly', () => {
    const pkg = realFormulaPackage();
    const content = readOdfFormulaContent(pkg);
    const documentPackage = readOdfFormula(pkg);

    expect(documentPackage.kind).toBe('formula');
    expect(documentPackage.metadata).toEqual(content.metadata);
    assertPackageRoundTrip(documentPackage, content);
  });

  it('carries the ContentFormula leaf itself as the package\'s single child, with no styles table to mint', () => {
    const documentPackage = formulaPackage(readOdfFormula(realFormulaPackage()));
    // A formula has no container structure to group: the tree's one child IS the leaf, and with no wrappers and no paragraphs anywhere the minting pass necessarily produces nothing.
    expect(documentPackage.children).toHaveLength(1);
    expect(documentPackage.children[0]?.starMath).toBe('f(x) = {x^2} over {2} + sqrt {x}');
    expect(documentPackage.styles).toBeUndefined();
  });

  it('throws the identical readOdfFormulaMathMl error for a package with no MathML root', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(() => readOdfFormula(pkg)).toThrow(/MathML/);
  });
});
