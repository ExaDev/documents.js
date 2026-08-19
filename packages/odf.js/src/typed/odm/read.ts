import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, findChildElement, rootElement } from '../../xml/query';

// Package -> OdmDocument: a reader for ODF MASTER documents (.odm, application/vnd.oasis.opendocument.text-master), each of whose "chapters" is a top-level text:section carrying a text:section-source child -- an EXTERNAL FILE REFERENCE (xlink:href pointing at a sibling .odt on disk), not an embedded package sub-document the way odf.js's other composite-document handling (manifest.ts's subdocumentDirectories) treats an embedded OLE object's own "<dir>/content.xml". This was a real correction made during this reader's own design phase, before any real file had been inspected -- see this module's own note below on what inspecting a genuine LibreOffice-produced .odm actually showed.
//
// EMPIRICALLY CONFIRMED, not assumed: a real two-chapter master document was built via a headless UNO Basic macro driving the SAME UNO calls LibreOffice's own "File > New > Master Document" / "Insert > Text from File" features use -- com.sun.star.frame.Desktop.loadComponentFromURL("private:factory/swriter/GlobalDocument", ...) to create a document of service com.sun.star.text.GlobalDocument, then, per chapter, a com.sun.star.text.TextSection instance inserted into the master's own Text and given a com.sun.star.text.SectionFileLink (FileURL + FilterName) pointing at a genuine, separately-authored-and-saved chapter .odt -- saved with LibreOffice's own real "writerglobal8" export filter (confirmed against main.xcd/writer.xcd: this is the ODF Text Master filter, DocumentService com.sun.star.text.GlobalDocument, URLPattern "private:factory/swriter/GlobalDocument*", Extension "odm"). The resulting real.odm was unzipped and content.xml inspected directly -- not reconstructed from memory or from the ODF schema alone. Three things this settled, all load-bearing for this reader's own design below:
//
// 1. text:section-source is ALWAYS self-closing/empty in real output: `<text:section-source xlink:href="../chapter1.odt" text:filter-name="writer8"/>`, with no children and, notably, NO xlink:show/xlink:type attributes at all -- contradicting this task's own design-phase assumption of an `xlink:show="embed"` attribute, which genuine LibreOffice output simply does not write. `text:filter-name` (confirmed as this exact attribute name, not "text:filter" or "office:filter-name") carries the IMPORT filter LibreOffice should use to re-read the linked file -- "writer8" here, mirroring the SAME filter name used to save/read a plain .odt.
// 2. A chapter's own REAL content (its heading text, its body paragraphs -- everything actually authored in chapter1.odt/chapter2.odt) is NEVER cached inside the master document's own text:section. Proven two ways: (a) content.xml has no trace of either chapter's own text ("Chapter One: Introduction", "This is the first chapter's own body text...", etc.) anywhere, even though setting FileLink DID synchronously pull that text into the LIVE in-memory document (oText.getString() on the freshly-linked master document returns both chapters' full text, confirmed via macro logging) -- LibreOffice resolves and displays linked content at edit/view time but deliberately does not persist it to content.xml on save; (b) META-INF/manifest.xml lists no entry at all for either chapter file, confirming they are genuinely external to the package, exactly as this reader's own background brief stated, now independently reconfirmed from the manifest side as well as the content.xml side.
// 3. A top-level text:section CAN still have non-empty XML children in real output -- but what actually appeared there is NOT chapter content of any kind. The FIRST section linked into a fresh master document (and only the first -- confirmed by re-running with a single-section document, where the identical structure attaches to that document's own sole section) picks up ten empty, text-less `<text:h text:style-name="Heading_20_N" text:level="N"/>` elements, one per outline level 1-10, inserted immediately after text:section-source. These carry no text nodes and match neither chapter's real heading ("Chapter One: Introduction" / "Chapter Two: Findings") -- they are LibreOffice's own internal chapter-numbering-continuity bookkeeping (seeding the outline-numbering counter's carry-over state at the point continuous numbering first crosses a linked-section boundary), not a cached copy of anything an author wrote. This is exactly why `inlineContent` below is populated NEVER, not "when text:section has children": the one real case that DOES produce children is precisely the case where surfacing them would be actively misleading, not helpful. See readSection's own note.
//
// SCOPE: only TOP-LEVEL text:section elements (direct children of office:text) are read -- matching a master document's own real shape, where every chapter section sits directly under office:text with no further nesting in any file actually produced for this verification. A text:section with no text:section-source child (ODF's generic non-master-document section, e.g. for multi-column layout) is silently skipped, exactly as odt's own readOdtContent transparently unwraps a plain text:section rather than treating it as a chapter. A text:section that has a text:section-source child but is missing its own required text:name, or whose text:section-source is missing its own required xlink:href, is likewise skipped (degrade-with-diagnostic-free-skip, matching this codebase's general "malformed but salvageable" posture) rather than failing the whole document read over one malformed chapter reference -- per the OASIS schema both attributes are required, so a real producer's output should never actually hit this path; it exists purely so one malformed section doesn't take down every other genuinely readable chapter in the same file. `href` is returned completely verbatim, exactly as the producer wrote it (here, a relative "../chapter1.odt" -- see this module's own note above on why the ".." appears even though both files share one directory: package-relative addressing treats content.xml's own base URI as the PACKAGE FILE itself, so a sibling-directory reference needs the extra level to escape it) -- this reader never attempts to resolve it against a filesystem or fetch the linked file's own content.

export interface OdmSection {
  name: string;
  href: string;
  filterName?: string;
  // Never populated -- see this module's own top-of-file note (point 3) on why the one real case a top-level text:section has children in genuine LibreOffice output is a numbering-continuity artifact, not chapter content, and surfacing it here would misrepresent it as such. Kept in the type (rather than dropped entirely) because a text:section MAY validly carry real inline content under the OASIS schema even though no producer this reader was verified against ever emits it -- a future reader revision that does observe genuine cached content in some other producer's output has a field ready to populate, rather than needing a breaking type change.
  inlineContent?: readonly XmlNode[];
}

export interface OdmDocument {
  sections: readonly OdmSection[];
}

const CONTENT_PART = 'content.xml';

// One top-level text:section -> OdmSection, or undefined if this section is not a master-document chapter reference at all (no text:section-source child) or is missing a required attribute (see this module's own top-of-file SCOPE note).
function readSection(element: XmlElement): OdmSection | undefined {
  const sourceElement = findChildElement(element.children, 'text:section-source');
  if (sourceElement === undefined) {
    return undefined;
  }
  const name = attrValue(element, 'text:name');
  const href = attrValue(sourceElement, 'xlink:href');
  if (name === undefined || href === undefined) {
    return undefined;
  }
  const filterName = attrValue(sourceElement, 'text:filter-name');
  return filterName === undefined ? { name, href } : { name, href, filterName };
}

// Package -> OdmDocument. Throws only when content.xml itself, or its own office:body/office:text element, is missing -- a genuinely unusable package, mirroring every other odf.js typed reader's own "missing required structural element" throw convention (see e.g. readOdtContent).
export function readOdm(pkg: Package): OdmDocument {
  const contentPart = pkg.parts[CONTENT_PART];
  if (contentPart?.kind !== 'xml') {
    throw new Error(`readOdm: package has no ${CONTENT_PART} part`);
  }
  const contentRoot = rootElement(contentPart.nodes);
  const body = contentRoot === undefined ? undefined : findChildElement(contentRoot.children, 'office:body');
  const textElement = body === undefined ? undefined : findChildElement(body.children, 'office:text');
  if (textElement === undefined) {
    throw new Error(`readOdm: ${CONTENT_PART} has no office:body/office:text element`);
  }

  const sections: OdmSection[] = [];
  for (const node of textElement.children) {
    if (node.type !== 'element' || node.tag !== 'text:section') {
      continue;
    }
    const section = readSection(node);
    if (section !== undefined) {
      sections.push(section);
    }
  }

  return { sections };
}
