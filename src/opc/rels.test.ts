import type { Package } from 'ooxml.js';
import { resolveRelationships } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { addRelationship } from './rels';

const IMAGE_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function emptyPackage(): Package {
  return { parts: {} };
}

describe('addRelationship', () => {
  it('creates the .rels part when none exists and allocates rId1', () => {
    const pkg = emptyPackage();
    const id = addRelationship(pkg, 'word/document.xml', { type: IMAGE_TYPE, target: 'media/image1.png' });
    expect(id).toBe('rId1');
    const resolved = resolveRelationships(pkg, 'word/document.xml');
    expect(resolved.get('rId1')).toEqual({ type: IMAGE_TYPE, target: 'word/media/image1.png', targetMode: undefined });
  });

  it('allocates the next id above the highest existing numeric suffix', () => {
    const pkg = emptyPackage();
    addRelationship(pkg, 'word/document.xml', { type: IMAGE_TYPE, target: 'media/image1.png' });
    addRelationship(pkg, 'word/document.xml', { type: IMAGE_TYPE, target: 'media/image2.png' });
    const third = addRelationship(pkg, 'word/document.xml', { type: IMAGE_TYPE, target: 'media/image3.png' });
    expect(third).toBe('rId3');
  });

  it('preserves an existing relationship when adding a new one', () => {
    const pkg = emptyPackage();
    addRelationship(pkg, 'word/document.xml', { type: IMAGE_TYPE, target: 'media/image1.png' });
    addRelationship(pkg, 'word/document.xml', { type: IMAGE_TYPE, target: 'media/image2.png' });
    const resolved = resolveRelationships(pkg, 'word/document.xml');
    expect(resolved.size).toBe(2);
    expect(resolved.get('rId1')?.target).toBe('word/media/image1.png');
    expect(resolved.get('rId2')?.target).toBe('word/media/image2.png');
  });

  it('keeps an External targetMode when set', () => {
    const pkg = emptyPackage();
    const HYPERLINK_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
    addRelationship(pkg, 'word/document.xml', {
      type: HYPERLINK_TYPE,
      target: 'https://example.com',
      targetMode: 'External',
    });
    const resolved = resolveRelationships(pkg, 'word/document.xml');
    expect(resolved.get('rId1')).toEqual({
      type: HYPERLINK_TYPE,
      target: 'https://example.com',
      targetMode: 'External',
    });
  });
});
