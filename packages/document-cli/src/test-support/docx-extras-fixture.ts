// A real docx that carries every field `readDocxExtras` (documents.js) reads and `readDocxContent`'s own `ContentDocument` cannot: comments, footnotes, headers, footers, and a numbering definition. `DocxEditor` has no write side for any of these -- comments/footnotes/headers/footers/numbering are none of them addressable through `DocxBody`/`DocxParagraph` -- so this builder starts from a real editor-built package and writes the extra parts directly. Comments/footnotes/numbering resolve from conventional paths with no relationship indirection (`word/comments.xml`, `word/footnotes.xml`, `word/numbering.xml`); the header/footer parts do not -- `readHeaderFooterParts`/`readSectionHeaderFooters` (ooxml.js) resolve `word/header1.xml`/`word/footer1.xml` only through a real `w:headerReference`/`w:footerReference` on the document's own trailing `w:sectPr` and the relationship each names, so this builder also wires those in (see that package's own `src/typed/docx/read.ts`, and documents.js's `src/ooxml/docx/extras.ts`/`src/typed/docx/numbering.ts` in ooxml.js).
import { childrenWithTag, createDocx, encodePackage, rootElement, type XmlElement } from 'documents.js';
import { el, txt, xmlDeclaration } from './ooxml-fixture';

const WORDML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

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
  numId: '1',
  numberingLevel: { format: 'decimal', text: '%1.' },
} as const;

// The one child of `parent` tagged `tag` -- thrown rather than returned as undefined, since every call site below names a structural element `createEmptyDocxPackage` (documents.js) is known to always produce, and a silently-absent element here would misbuild the fixture rather than signal a real inconsistency.
function requireChild(parent: XmlElement, tag: string): XmlElement {
  const [child] = childrenWithTag(parent, tag);
  if (child === undefined) {
    throw new Error(`fixture invariant violated: ${parent.tag} has no ${tag} child`);
  }
  return child;
}

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

  // Reference both parts from the document's own trailing section (createDocx's single, final w:sectPr -- see documents.js's DocxEditor) through a real w:headerReference/w:footerReference pair and the relationship each names -- an unreferenced word/header1.xml/word/footer1.xml part is otherwise invisible to readDocxExtras, which resolves parts by reference alone, never by a catch-all word/header*.xml scan.
  const documentRoot = rootElement(pkg.parts['word/document.xml']);
  if (documentRoot === undefined) {
    throw new Error('createDocx did not produce a word/document.xml root element');
  }
  const sectPr = requireChild(requireChild(documentRoot, 'w:body'), 'w:sectPr');
  sectPr.children.unshift(
    el('w:headerReference', { 'w:type': 'default', 'r:id': 'rIdHeader1' }),
    el('w:footerReference', { 'w:type': 'default', 'r:id': 'rIdFooter1' }),
  );

  const documentRels = rootElement(pkg.parts['word/_rels/document.xml.rels']);
  if (documentRels === undefined) {
    throw new Error('createDocx did not produce a word/_rels/document.xml.rels root element');
  }
  documentRels.children.push(
    el('Relationship', { Id: 'rIdHeader1', Type: HEADER_REL, Target: 'header1.xml' }),
    el('Relationship', { Id: 'rIdFooter1', Type: FOOTER_REL, Target: 'footer1.xml' }),
  );

  return encodePackage(pkg);
}
