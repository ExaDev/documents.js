import type { XmlElement } from 'odf.js';
import { decodePackage, encodePackage, rootElement, validateManifest } from 'odf.js';
import { attr } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { HEADING_STYLES } from '../../layout/shared';
import { createEmptyOdtPackage } from './scaffold';

describe('createEmptyOdtPackage', () => {
  it('has every part a minimal odt needs', () => {
    const pkg = createEmptyOdtPackage();
    expect(Object.keys(pkg.parts).sort()).toEqual(['META-INF/manifest.xml', 'content.xml', 'meta.xml', 'mimetype', 'styles.xml'].sort());
  });

  it('round-trips through encodePackage/decodePackage unchanged', () => {
    const pkg = createEmptyOdtPackage();
    expect(decodePackage(encodePackage(pkg))).toEqual(pkg);
  });

  it('declares the odt media type and a manifest with no validation problems', () => {
    const pkg = createEmptyOdtPackage();
    const mimetype = pkg.parts.mimetype;
    expect(mimetype?.kind).toBe('binary');
    expect(validateManifest(pkg)).toEqual([]);
  });

  it('has an office:body/office:text element in content.xml', () => {
    const pkg = createEmptyOdtPackage();
    const root = rootElement(pkg.parts['content.xml']?.kind === 'xml' ? pkg.parts['content.xml'].nodes : []);
    expect(root?.tag).toBe('office:document-content');
    const body = root?.children.find((c) => c.type === 'element' && c.tag === 'office:body');
    const text = body?.type === 'element' ? body.children.find((c) => c.type === 'element' && c.tag === 'office:text') : undefined;
    expect(text).toBeDefined();
  });

  it('has a page-layout -> master-page chain in styles.xml', () => {
    const pkg = createEmptyOdtPackage();
    const root = rootElement(pkg.parts['styles.xml']?.kind === 'xml' ? pkg.parts['styles.xml'].nodes : []);
    const automaticStyles = root?.children.find((c) => c.type === 'element' && c.tag === 'office:automatic-styles');
    const pageLayout = automaticStyles?.type === 'element' ? automaticStyles.children.find((c) => c.type === 'element' && c.tag === 'style:page-layout') : undefined;
    expect(pageLayout).toBeDefined();
    const masterStyles = root?.children.find((c) => c.type === 'element' && c.tag === 'office:master-styles');
    const masterPage = masterStyles?.type === 'element' ? masterStyles.children.find((c) => c.type === 'element' && c.tag === 'style:master-page') : undefined;
    expect(masterPage).toBeDefined();
  });

  // Every level OdtParagraph's headingLevel setter can point at needs a real definition, or the reference resolves to nothing and the heading renders unstyled in every consumer that resolves names (LibreOffice; odf.js's own resolveStyle cascade). The visual convention is the PDF layout engine's own HEADING_STYLES table -- the single source of truth -- so an odt this scaffold builds renders its headings the same way odtToPdf renders the same document.
  it('defines a Heading_20_N common style for every level of the heading convention in office:styles', () => {
    const pkg = createEmptyOdtPackage();
    const root = rootElement(pkg.parts['styles.xml']?.kind === 'xml' ? pkg.parts['styles.xml'].nodes : []);
    const officeStyles = root?.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'office:styles');
    const styleElements = (officeStyles?.children ?? []).filter((c): c is XmlElement => c.type === 'element' && c.tag === 'style:style');
    expect(styleElements).toHaveLength(Object.keys(HEADING_STYLES).length);
    for (const [level, style] of Object.entries(HEADING_STYLES)) {
      const styleElement = styleElements.find((c) => attr(c, 'style:name') === `Heading_20_${level}`);
      expect(styleElement, `Heading_20_${level}`).toBeDefined();
      expect(attr(styleElement!, 'style:display-name')).toBe(`Heading ${level}`);
      expect(attr(styleElement!, 'style:family')).toBe('paragraph');
      const textProperties = styleElement!.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'style:text-properties');
      expect(attr(textProperties!, 'fo:font-size')).toBe(`${String(style.sizePt)}pt`);
      expect(attr(textProperties!, 'fo:font-weight')).toBe(style.bold ? 'bold' : 'normal');
    }
  });
});
