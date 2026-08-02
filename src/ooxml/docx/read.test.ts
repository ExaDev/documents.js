import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { minimalDocxPackage } from '../../test-support/docx';
import { readDocxContent } from './read';

// readDocxContent is now a thin adapter over ooxml.js's own readDocx: the WordprocessingML style cascade, theme resolution, and document-order section/block walking all live upstream in ooxml.js now, with their own test coverage there. These tests exercise only the wrapping this file is actually responsible for -- ContentDocument's discriminant/formatVersion, the metadata/sections passthrough -- not the OOXML semantics readDocx itself resolves.

describe('readDocxContent', () => {
  it('wraps readDocx into a wordprocessing ContentDocument', () => {
    const doc = readDocxContent(minimalDocxPackage());
    expect(doc.kind).toBe('wordprocessing');
    expect(doc.formatVersion).toBe(CONTENT_FORMAT_VERSION);
  });

  it('passes sections through from readDocx unchanged, including a paragraph and a table', () => {
    const doc = readDocxContent(minimalDocxPackage());
    if (doc.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing document');
    }
    expect(doc.sections).toHaveLength(1);
    const [paragraph, table] = doc.sections[0]?.blocks ?? [];
    if (paragraph?.kind !== 'paragraph' || table?.kind !== 'table') {
      throw new Error('expected a paragraph followed by a table');
    }
    expect(paragraph.runs[0]?.text).toBe('Hello, world!');
    expect(table.columnWidthsPt).toEqual([225, 225]);
    const firstCellBlock = table.rows[0]?.cells[0]?.blocks[0];
    expect(firstCellBlock?.kind === 'paragraph' ? firstCellBlock.runs[0]?.text : undefined).toBe('A1');
  });

  it('spreads metadata from readDocx, leaving LayoutMetadata\'s PDF-only producer field unset', () => {
    const doc = readDocxContent(minimalDocxPackage());
    // The fixture package carries no docProps/core.xml, so every field is undefined -- confirming the mapping doesn't invent a value, not merely that it round-trips one.
    expect(doc.metadata).toEqual({});
    expect(doc.metadata.producer).toBeUndefined();
  });

  it('propagates readDocx\'s own error for a package with no word/document.xml', () => {
    expect(() => readDocxContent({ parts: {} })).toThrow(/word\/document\.xml/);
  });
});
