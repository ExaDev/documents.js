import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOds, odsToXlsx } from 'documents.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDocumentAtPath, saveDocumentTo } from './open-document.js';

// Real xlsx bytes with no XlsxEditor to build one directly: createOds() -> odsToXlsx() is documents.js's own PDF-bypassing bridge, reused here purely as a source of genuine xlsx bytes, the same trick the reducer tests use.
function xlsxTestBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOds();
  const sheet = editor.addSheet('Sheet1');
  sheet.cell(0, 0).value = { kind: 'string', value: 'Total' };
  sheet.cell(0, 1).value = { kind: 'number', value: 42 };
  return odsToXlsx(editor.toBytes());
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-xlsx-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('openDocumentAtPath for .xlsx', () => {
  it('opens read-only as a converted PDF preview instead of throwing', async () => {
    const bytes = xlsxTestBytes();
    const path = join(workspace, 'report.xlsx');
    await writeFile(path, bytes);

    const doc = await openDocumentAtPath(path);
    if (doc.format !== 'xlsx') {
      throw new Error(`expected an open xlsx document, got ${doc.format}`);
    }
    expect(doc.path).toBe(path);
    // A real xlsxToPdf conversion of a one-cell sheet produces at least one page -- this is the same LayoutDocument shape a real .pdf opens as, which is what lets the pdf page-list/page-items/item-detail screens browse it with no xlsx-specific code (see pdf/shared.ts's own broadened requirePdfDocument).
    expect(doc.layout.pages.length).toBeGreaterThan(0);
    // The original bytes are kept alongside the preview so a real export can re-run xlsxToPdf later with the caller's own fonts/diagnostics (see export-pdf.ts) rather than reusing this fixed preview conversion.
    expect(doc.bytes).toStrictEqual(bytes);
  });

  it('cannot be written back to disk -- it is read-only, the same as .odb (.pdf gained a real live-view editor and is no longer in this group)', async () => {
    const bytes = xlsxTestBytes();
    const path = join(workspace, 'report.xlsx');
    await writeFile(path, bytes);
    const doc = await openDocumentAtPath(path);

    await expect(saveDocumentTo(doc, join(workspace, 'copy.xlsx'))).rejects.toThrow(/read-only/);
  });
});
