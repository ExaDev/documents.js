import { decodePackage, encodePackage, rootElement, validateManifest } from 'odf.js';
import { describe, expect, it } from 'vitest';
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
});
