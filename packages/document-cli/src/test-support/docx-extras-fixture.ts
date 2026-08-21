// A real docx that carries every field `readDocxExtras` (documents.js) reads and `readDocxContent`'s own `ContentDocument` cannot: comments, footnotes, headers/footers, and a numbering definition. `DocxEditor` has no write side for any of these -- comments/footnotes/headers/footers/numbering are none of them addressable through `DocxBody`/`DocxParagraph` -- so this builder starts from a real editor-built package and writes the four extra parts directly, at the exact conventional paths (`word/comments.xml`, `word/footnotes.xml`, `word/header1.xml`/`word/footer1.xml`, `word/numbering.xml`) the reader resolves comments/footnotes/numbering from by fixed part path (see documents.js's own `src/ooxml/docx/extras.ts` and ooxml.js's `src/typed/docx/numbering.ts`). The header/footer parts are additionally REFERENCED structurally -- the body's own `w:sectPr` names both through `w:headerReference`/`w:footerReference` and the document's relationships -- so the structural half of the model (`headerFooterParts`/`sectionHeaderFooters`) is exercised, not just the flat per-part text arrays.
import { createDocx, encodePackage, type Package, type XmlElement } from 'documents.js';
import { el, txt, xmlDeclaration } from './ooxml-fixture';

const WORDML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const HEADER_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

function paragraphWithText(text: string): XmlElement {
  return el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt(text)])])]);
}

// The comment/footnote/header/footer/numbering text this fixture declares -- exported so a test asserting against `readDocxExtras`'s own output, or the `docx-extras` command's rendered lines, states its expectations against named constants rather than string literals repeated at every call site.
export const DOCX_EXTRAS_FIXTURE = {
  commentAuthor: 'Alice',
  commentWithAuthorText: 'Looks good to me.',
  commentWithoutAuthorText: 'No author on this one.',
  footnoteText: 'See appendix A.',
  headerText: 'Confidential Draft',
  footerText: 'Page footer text',
  headerPath: 'word/header1.xml',
  footerPath: 'word/footer1.xml',
  headerRelId: 'rIdHeader1',
  footerRelId: 'rIdFooter1',
  numId: '1',
  numberingLevel: { format: 'decimal', text: '%1.' },
} as const;

// A real docx, comments/footnotes/headers/footers/numbering included. The footnotes part also declares a `w:type="separator"` footnote -- the horizontal rule Word always writes alongside real footnotes -- deliberately, since `readDocxExtras`'s own `readFootnotes` (ooxml.js) skips exactly that type; a fixture that omitted it would never exercise the skip at all.
export function buildDocxWithExtras(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: 'An ordinary body paragraph.' });
  const pkg = editor.toPackage();

  pkg.parts['word/comments.xml'] = {
    kind: 'xml',
    nodes: [
      xmlDeclaration(),
      el('w:comments', { 'xmlns:w': WORDML_NS }, [
        el('w:comment', { 'w:id': '0', 'w:author': DOCX_EXTRAS_FIXTURE.commentAuthor }, [paragraphWithText(DOCX_EXTRAS_FIXTURE.commentWithAuthorText)]),
        el('w:comment', { 'w:id': '1' }, [paragraphWithText(DOCX_EXTRAS_FIXTURE.commentWithoutAuthorText)]),
      ]),
    ],
  };

  pkg.parts['word/footnotes.xml'] = {
    kind: 'xml',
    nodes: [
      xmlDeclaration(),
      el('w:footnotes', { 'xmlns:w': WORDML_NS }, [
        el('w:footnote', { 'w:id': '-1', 'w:type': 'separator' }, [el('w:p', {}, [el('w:r', {}, [el('w:separator')])])]),
        el('w:footnote', { 'w:id': '1' }, [paragraphWithText(DOCX_EXTRAS_FIXTURE.footnoteText)]),
      ]),
    ],
  };

  pkg.parts['word/header1.xml'] = { kind: 'xml', nodes: [xmlDeclaration(), el('w:hdr', { 'xmlns:w': WORDML_NS }, [paragraphWithText(DOCX_EXTRAS_FIXTURE.headerText)])] };
  pkg.parts['word/footer1.xml'] = { kind: 'xml', nodes: [xmlDeclaration(), el('w:ftr', { 'xmlns:w': WORDML_NS }, [paragraphWithText(DOCX_EXTRAS_FIXTURE.footerText)])] };
  referenceHeaderFooterParts(pkg);

  pkg.parts['word/numbering.xml'] = {
    kind: 'xml',
    nodes: [
      xmlDeclaration(),
      el('w:numbering', { 'xmlns:w': WORDML_NS }, [
        el('w:abstractNum', { 'w:abstractNumId': '0' }, [
          el('w:lvl', { 'w:ilvl': '0' }, [
            el('w:start', { 'w:val': '1' }),
            el('w:numFmt', { 'w:val': DOCX_EXTRAS_FIXTURE.numberingLevel.format }),
            el('w:lvlText', { 'w:val': DOCX_EXTRAS_FIXTURE.numberingLevel.text }),
          ]),
        ]),
        el('w:num', { 'w:numId': DOCX_EXTRAS_FIXTURE.numId }, [el('w:abstractNumId', { 'w:val': '0' })]),
      ]),
    ],
  };

  return encodePackage(pkg);
}

function firstChildElement(element: XmlElement, tag: string): XmlElement | undefined {
  return element.children.find((child): child is XmlElement => child.type === 'element' && child.tag === tag);
}

// Names both header/footer parts from the body's own trailing w:sectPr through the document's relationships -- the reference spelling a real docx carries and the structural half of readDocxExtras (headerFooterParts/sectionHeaderFooters) resolves. CT_SectPr's own child sequence puts the EG_HdrFtrReferences group first, so the two reference elements are prepended ahead of the w:pgSz/w:pgMar the editor's builder already wrote; the relationship ids are deliberately non-numeric so they cannot collide with the image relationships the builder may already have minted.
function referenceHeaderFooterParts(pkg: Package): void {
  const relsRoot = pkg.parts['word/_rels/document.xml.rels'];
  if (relsRoot?.kind !== 'xml') {
    throw new Error('docx-extras fixture: editor-built package carries no word/_rels/document.xml.rels part');
  }
  const relationships = relsRoot.nodes.find((node): node is XmlElement => node.type === 'element' && node.tag === 'Relationships');
  const documentRoot = pkg.parts['word/document.xml']?.kind === 'xml' ? pkg.parts['word/document.xml'].nodes.find((node): node is XmlElement => node.type === 'element' && node.tag === 'w:document') : undefined;
  const body = documentRoot === undefined ? undefined : firstChildElement(documentRoot, 'w:body');
  const sectPr = body === undefined ? undefined : firstChildElement(body, 'w:sectPr');
  if (relationships === undefined || sectPr === undefined) {
    throw new Error('docx-extras fixture: editor-built package has no Relationships root or body w:sectPr to name the header/footer parts from');
  }
  relationships.children.push(
    el('Relationship', { Id: DOCX_EXTRAS_FIXTURE.headerRelId, Type: HEADER_REL_TYPE, Target: 'header1.xml' }),
    el('Relationship', { Id: DOCX_EXTRAS_FIXTURE.footerRelId, Type: FOOTER_REL_TYPE, Target: 'footer1.xml' }),
  );
  sectPr.children.unshift(
    el('w:headerReference', { 'r:id': DOCX_EXTRAS_FIXTURE.headerRelId, 'w:type': 'default' }),
    el('w:footerReference', { 'r:id': DOCX_EXTRAS_FIXTURE.footerRelId, 'w:type': 'default' }),
  );
}
