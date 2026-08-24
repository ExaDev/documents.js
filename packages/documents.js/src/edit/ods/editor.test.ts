import { decodePackage } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { minimalOdsBytes, minimalOdsPackage } from '../../test-support/ods';
import { createOds, openOds } from './editor';

describe('openOds / createOds', () => {
  it('openOds reads an existing package and exposes its sheets', () => {
    const editor = openOds(minimalOdsBytes());
    const sheets = editor.sheets();
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.name).toBe('Data');
  });

  it('createOds starts from a valid, empty, encodable package with one default sheet', () => {
    const editor = createOds();
    expect(editor.sheets()).toHaveLength(1);
    expect(editor.sheets()[0]?.name).toBe('Sheet1');
    const bytes = editor.toBytes();
    expect(decodePackage(bytes)).toEqual(editor.toPackage());
  });
});

describe('OdsEditor.sheets / sheet / addSheet / removeSheetAt', () => {
  it('addSheet appends a new, independently addressable sheet', () => {
    const editor = createOds();
    editor.addSheet('Second');
    editor.addSheet('Third');
    expect(editor.sheets().map((s) => s.name)).toEqual(['Sheet1', 'Second', 'Third']);
  });

  it('sheet(name) finds a sheet by name, or throws for one that does not exist', () => {
    const editor = createOds();
    editor.addSheet('Second');
    expect(editor.sheet('Second').name).toBe('Second');
    expect(() => editor.sheet('NoSuchSheet')).toThrow(/no sheet named/);
  });

  it('removeSheetAt removes the sheet at that index', () => {
    const editor = createOds();
    editor.addSheet('Second');
    editor.addSheet('Third');
    editor.removeSheetAt(1);
    expect(editor.sheets().map((s) => s.name)).toEqual(['Sheet1', 'Third']);
  });

  it('removeSheetAt throws for an out-of-range index', () => {
    const editor = createOds();
    expect(() => { editor.removeSheetAt(5); }).toThrow(/sheet index 5/);
  });

  it('every sheet addSheet creates shares the same table-family print-settings style (reused, not re-minted per sheet)', () => {
    const editor = createOds();
    editor.addSheet('Second');
    editor.addSheet('Third');
    const contentPart = editor.toPackage().parts['content.xml'];
    const root = contentPart?.kind === 'xml' ? contentPart.nodes.find((n) => n.type === 'element') : undefined;
    const automaticStyles = root?.type === 'element' ? root.children.find((c) => c.type === 'element' && c.tag === 'office:automatic-styles') : undefined;
    const tableStyles =
      automaticStyles?.type === 'element'
        ? automaticStyles.children.filter((c) => c.type === 'element' && c.tag === 'style:style' && c.attributes.some((a) => a.name === 'style:family' && a.value === 'table'))
        : [];
    expect(tableStyles).toHaveLength(1);
  });
});

describe('live-view fidelity: editing one sheet must not disturb another part of the package', () => {
  it('setting a cell value in the opened fixture leaves every other part byte-for-byte unchanged, except appending automatic styles/content as needed', () => {
    const before = minimalOdsPackage();
    const editor = openOds(minimalOdsBytes());
    editor.sheets()[0]!.cell(5, 5).value = { kind: 'number', value: 1 };
    const after = editor.toPackage();
    expect(after.parts['styles.xml']).toEqual(before.parts['styles.xml']);
    expect(after.parts['meta.xml']).toEqual(before.parts['meta.xml']);
  });
});
