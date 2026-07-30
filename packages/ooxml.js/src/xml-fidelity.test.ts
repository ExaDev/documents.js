// Fidelity model for this file.
//
// Idempotency (decode -> encode -> decode producing a deep-equal Package) does NOT by itself prove original-fidelity: a construct the parser drops entirely still round-trips stably, because the dropped state is itself a fixed point. The DOCTYPE finding below is the clearest example -- the declaration and its internal ENTITY subset vanish from the node tree, yet decode -> encode -> decode stays deep-equal because there is nothing left to lose. The preservation assertions in this file are therefore what actually guards against silent loss: each one walks the decoded node tree and confirms the specific XmlNode variant (cdata, comment, pi, text, element) survived in the right place with the right value, or, for the documented limitations, asserts precisely what was lost so the ceiling is explicit and regresses loudly if behaviour changes.
//
// Coverage here is part-content-faithful, not ZIP-container byte-identical: the parsed node forest and the set of parts round-trip, but serialisation normalises details that do not affect the infoset -- empty elements re-serialise as open/close pairs rather than self-closing tags, the XML declaration whitespace is normalised, and entity references stay as raw entity-reference strings in text and attribute values rather than being decoded to characters (processEntities is false on both parser and builder).

import { describe, expect, it } from 'vitest';
import { decodePackage, encodePackage, zipPackage } from './index';
import type { Package, XmlNode, XmlCdata, XmlComment, XmlPi, XmlElement, XmlText } from './index';

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);

const ROOT_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);

function packageWithDocumentXml(documentXml: string): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': ROOT_RELS,
    'word/document.xml': enc(documentXml),
  };
}

const isText = (n: XmlNode): n is XmlText => n.type === 'text';
const isCdata = (n: XmlNode): n is XmlCdata => n.type === 'cdata';
const isComment = (n: XmlNode): n is XmlComment => n.type === 'comment';
const isPi = (n: XmlNode): n is XmlPi => n.type === 'pi';
const isElement = (n: XmlNode): n is XmlElement => n.type === 'element';

function walk(nodes: XmlNode[], visit: (node: XmlNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === 'element') {
      walk(node.children, visit);
    }
  }
}

function allNodes(roots: XmlNode[]): XmlNode[] {
  const out: XmlNode[] = [];
  walk(roots, (n) => out.push(n));
  return out;
}

function findElement(roots: XmlNode[], tag: string): XmlElement | undefined {
  return allNodes(roots).find((n): n is XmlElement => n.type === 'element' && n.tag === tag);
}

function documentXmlNodes(pkg: Package): XmlNode[] {
  const part = pkg.parts['word/document.xml'];
  if (part?.kind !== 'xml') {
    throw new Error('word/document.xml is not an xml part');
  }
  return part.nodes;
}

describe('XML construct fidelity', () => {
  describe('CDATA section', () => {
    const parts = packageWithDocumentXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><r><![CDATA[ unescaped <markup> & text ]]></r></w:body></w:document>',
    );

    it('is idempotent across decode -> encode -> decode', () => {
      const pkg1 = decodePackage(zipPackage(parts));
      const pkg2 = decodePackage(encodePackage(pkg1));
      expect(pkg2).toEqual(pkg1);
    });

    it('preserves the cdata node with its raw, unescaped value', () => {
      const nodes = allNodes(documentXmlNodes(decodePackage(zipPackage(parts))));
      const cdata = nodes.find(isCdata);
      expect(cdata?.value).toBe(' unescaped <markup> & text ');
    });
  });

  describe('XML comment', () => {
    const parts = packageWithDocumentXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><r><!-- a comment --><t>text</t></r></w:body></w:document>',
    );

    it('is idempotent across decode -> encode -> decode', () => {
      const pkg1 = decodePackage(zipPackage(parts));
      const pkg2 = decodePackage(encodePackage(pkg1));
      expect(pkg2).toEqual(pkg1);
    });

    it('preserves the comment node with its internal whitespace intact', () => {
      const nodes = allNodes(documentXmlNodes(decodePackage(zipPackage(parts))));
      const comment = nodes.find(isComment);
      expect(comment?.value).toBe(' a comment ');
    });
  });

  describe('non-XML processing instruction', () => {
    // Documented limitation, not a failing round-trip: the processing-instruction node survives decode, but its pseudo-attribute payload (data="1") is dropped on parse -- the PI re-serialises as <?custom?> with an empty content string. The representation is stable and lossy; the assertions below pin both halves of that behaviour so a future change to either surfaces here.
    const parts = packageWithDocumentXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><r><?custom data="1"?>text</r></w:body></w:document>',
    );

    it('is idempotent across decode -> encode -> decode', () => {
      const pkg1 = decodePackage(zipPackage(parts));
      const pkg2 = decodePackage(encodePackage(pkg1));
      expect(pkg2).toEqual(pkg1);
    });

    it('preserves the pi target but drops the pseudo-attribute payload', () => {
      const nodes = allNodes(documentXmlNodes(decodePackage(zipPackage(parts))));
      const pi = nodes.find(isPi);
      expect(pi?.target).toBe('custom');
      expect(pi?.content).toBe('');
    });
  });

  describe('named and numeric character entities', () => {
    const parts = packageWithDocumentXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><r>&lt;tag&gt; A is &#65; or &#x41; quote &quot;q&quot; apos &apos;a&apos;</r></w:body></w:document>',
    );

    it('is idempotent across decode -> encode -> decode', () => {
      const pkg1 = decodePackage(zipPackage(parts));
      const pkg2 = decodePackage(encodePackage(pkg1));
      expect(pkg2).toEqual(pkg1);
    });

    it('preserves entity references verbatim as raw text (not decoded to characters)', () => {
      const r = findElement(documentXmlNodes(decodePackage(zipPackage(parts))), 'r');
      const text = r?.children.find(isText);
      expect(text?.value).toBe('&lt;tag&gt; A is &#65; or &#x41; quote &quot;q&quot; apos &apos;a&apos;');
    });
  });

  describe('DOCTYPE declaration', () => {
    // Documented limitation, not a failing round-trip: fast-xml-parser silently discards the DOCTYPE and its internal ENTITY subset (<!ENTITY x "y">). The XmlNode model has no doctype variant, so nothing in the tree represents it; the document degrades to a [declaration, root element] forest. This is security-positive (it neutralises XXE and billion-laughs expansion) but it is a real fidelity ceiling -- a DOCX carrying a DOCTYPE will not round-trip. The assertions below pin the dropped state.
    const parts = packageWithDocumentXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE root [<!ENTITY x "y">]><root><e/></root>',
    );

    it('is idempotent across decode -> encode -> decode', () => {
      const pkg1 = decodePackage(zipPackage(parts));
      const pkg2 = decodePackage(encodePackage(pkg1));
      expect(pkg2).toEqual(pkg1);
    });

    it('drops the doctype and internal subset entirely (no node represents it)', () => {
      const nodes = documentXmlNodes(decodePackage(zipPackage(parts)));
      expect(nodes).toHaveLength(2);
      expect(nodes[0]?.type).toBe('declaration');
      const root = nodes[1];
      expect(root?.type).toBe('element');
      if (root?.type === 'element') {
        expect(root.tag).toBe('root');
      }
      expect(allNodes(nodes).some((n) => n.type === 'comment' || n.type === 'pi' || n.type === 'cdata')).toBe(false);
    });
  });

  describe('deep nesting, empty elements, and self-closing elements', () => {
    const parts = packageWithDocumentXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><a><b><c><d><e><f><g><h>deep</h></g></f></e></d></c></b></a><empty/><self attr="1"/></w:body></w:document>',
    );

    it('is idempotent across decode -> encode -> decode', () => {
      const pkg1 = decodePackage(zipPackage(parts));
      const pkg2 = decodePackage(encodePackage(pkg1));
      expect(pkg2).toEqual(pkg1);
    });

    it('preserves nesting depth, empty-element identity, and attributes (self-closing vs open/close collapses to the same node shape)', () => {
      const roots = documentXmlNodes(decodePackage(zipPackage(parts)));

      // The full eight-level chain a > b > c > d > e > f > g > h is preserved as nested elements.
      const chain = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      let cursor: XmlElement | undefined = findElement(roots, 'a');
      for (const tag of chain) {
        expect(cursor?.tag).toBe(tag);
        cursor = cursor?.children.find(isElement);
      }

      // The innermost <h> carries a single text child.
      const h = findElement(roots, 'h');
      expect(h?.children.find(isText)?.value).toBe('deep');

      // Empty elements keep zero children regardless of source syntax.
      expect(findElement(roots, 'empty')?.children).toHaveLength(0);

      // The self-closing element keeps its attribute and its zero children.
      const self = findElement(roots, 'self');
      expect(self?.attributes).toEqual([{ name: 'attr', value: '1' }]);
      expect(self?.children).toHaveLength(0);
    });
  });

  describe('mixed content with interleaved text and elements', () => {
    const parts = packageWithDocumentXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><p>hello <b>bold</b> world <i></i> tail</p></w:body></w:document>',
    );

    it('is idempotent across decode -> encode -> decode', () => {
      const pkg1 = decodePackage(zipPackage(parts));
      const pkg2 = decodePackage(encodePackage(pkg1));
      expect(pkg2).toEqual(pkg1);
    });

    it('preserves child ordering, distinct text runs, and whitespace without coalescing', () => {
      const p = findElement(documentXmlNodes(decodePackage(zipPackage(parts))), 'p');
      const kids = p?.children ?? [];
      expect(kids).toHaveLength(5);
      expect(kids[0]).toEqual({ type: 'text', value: 'hello ' });
      expect(kids[1]).toMatchObject({ type: 'element', tag: 'b' });
      expect(kids[2]).toEqual({ type: 'text', value: ' world ' });
      expect(kids[3]).toMatchObject({ type: 'element', tag: 'i' });
      expect(kids[4]).toEqual({ type: 'text', value: ' tail' });

      const b = kids[1];
      if (b?.type === 'element') {
        expect(b.children.find(isText)?.value).toBe('bold');
      }
      const i = kids[3];
      if (i?.type === 'element') {
        expect(i.children).toHaveLength(0);
      }
    });
  });

  describe('default namespace, ordered attributes, and entity values in attributes', () => {
    const parts = packageWithDocumentXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><e xmlns="http://def.example" a="1" b="2" c="&amp;&lt;&gt;" d="multi word value"/></w:body></w:document>',
    );

    it('is idempotent across decode -> encode -> decode', () => {
      const pkg1 = decodePackage(zipPackage(parts));
      const pkg2 = decodePackage(encodePackage(pkg1));
      expect(pkg2).toEqual(pkg1);
    });

    it('preserves attribute order, the default namespace as a plain xmlns attribute, and literal (un-decoded) entity values', () => {
      const e = findElement(documentXmlNodes(decodePackage(zipPackage(parts))), 'e');
      expect(e?.attributes).toHaveLength(5);
      expect(e?.attributes[0]).toEqual({ name: 'xmlns', value: 'http://def.example' });
      expect(e?.children).toHaveLength(0);
      // processEntities is false, so entity references in attribute values survive as the literal entity-reference string.
      expect(e?.attributes.find((a) => a.name === 'c')?.value).toBe('&amp;&lt;&gt;');
      expect(e?.attributes.find((a) => a.name === 'd')?.value).toBe('multi word value');
    });
  });
});

describe('OOXML parts coverage', () => {
  const FULL_CONTENT_TYPES = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
  );
  const FULL_ROOT_RELS = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
  );
  const DOCUMENT = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>',
  );
  const STYLES = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
  );
  const CORE = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Round-trip</dc:title><cp:lastModifiedBy>tester</cp:lastModifiedBy></cp:coreProperties>',
  );
  const HEADER = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>',
  );
  const FOOTER = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer</w:t></w:r></w:p></w:ftr>',
  );
  const COMMENTS = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="tester"><w:p><w:r><w:t>A comment</w:t></w:r></w:p></w:comment></w:comments>',
  );
  const FOOTNOTES = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:t></w:t></w:r></w:p></w:footnote></w:footnotes>',
  );

  function fullDocxParts(): Record<string, Uint8Array<ArrayBuffer>> {
    return {
      '[Content_Types].xml': FULL_CONTENT_TYPES,
      '_rels/.rels': FULL_ROOT_RELS,
      'word/document.xml': DOCUMENT,
      'word/styles.xml': STYLES,
      'docProps/core.xml': CORE,
      'word/header1.xml': HEADER,
      'word/footer1.xml': FOOTER,
      'word/comments.xml': COMMENTS,
      'word/footnotes.xml': FOOTNOTES,
    };
  }

  it('is idempotent across decode -> encode -> decode for the broader OOXML part set', () => {
    const pkg1 = decodePackage(zipPackage(fullDocxParts()));
    const pkg2 = decodePackage(encodePackage(pkg1));
    expect(pkg2).toEqual(pkg1);
  });

  it('preserves the full part set (content types, rels, document, styles, core props, header, footer, comments, footnotes)', () => {
    const parts = fullDocxParts();
    const pkg1 = decodePackage(zipPackage(parts));
    expect(Object.keys(pkg1.parts).sort()).toEqual(Object.keys(parts).sort());
  });
});
