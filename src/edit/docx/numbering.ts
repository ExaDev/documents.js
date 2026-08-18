import type { XmlElement, XmlNode } from 'ooxml.js';
import { el } from '../../xml/fragment';

// Synthesises a word/numbering.xml part for buildDocxPackage: buildDocxPackage writes w:numPr/w:numId references on list paragraphs (via DocxParagraph.list) but createEmptyDocxPackage builds NO numbering part, so without this the numIds dangle and Word renders no bullets/numbers. ContentListMembership carries only { numId?, level } and no format, so every level is a BULLET template (numbered lists degrade to bullets — a documented limitation; preserving ordered-vs-bullet would need a format field on ContentListMembership, which is a document-schema.js change deliberately out of scope here).

export const NUMBERING_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
export const NUMBERING_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
export const NUMBERING_PART_PATH = 'word/numbering.xml';

export function declaration(): XmlNode {
  return { type: 'declaration', attributes: [{ name: 'version', value: '1.0' }, { name: 'encoding', value: 'UTF-8' }, { name: 'standalone', value: 'yes' }] };
}

export interface NumberingEntry {
  // The source membership's numId, or undefined for the shared no-numId group (see content.ts's collectListNumIds comment). Carried for diagnosis only -- the XML below writes remappedNumId/abstractNumId, never this.
  readonly sourceNumId: string | undefined;
  readonly remappedNumId: string;
  readonly abstractNumId: string;
  readonly levels: readonly number[];
}

// Builds a w:numbering root carrying one w:abstractNum (bullet-template levels) + one w:num per distinct source numId.
export function buildNumberingRoot(entries: readonly NumberingEntry[]): XmlElement {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const abstractNums = entries.map((entry) =>
    el('w:abstractNum', { 'w:abstractNumId': entry.abstractNumId }, entry.levels.map((level) =>
      el('w:lvl', { 'w:ilvl': String(level), 'w:tentative': '1' }, [
        el('w:start', { 'w:val': '1' }),
        el('w:numFmt', { 'w:val': 'bullet' }),
        el('w:lvlText', { 'w:val': '•' }),
        el('w:lvlJc', { 'w:val': 'left' }),
      ]),
    )),
  );
  const nums = entries.map((entry) =>
    el('w:num', { 'w:numId': entry.remappedNumId }, [el('w:abstractNumId', { 'w:val': entry.abstractNumId })]),
  );
  return el('w:numbering', { 'xmlns:w': W }, [...abstractNums, ...nums]);
}
