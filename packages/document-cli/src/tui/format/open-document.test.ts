import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOds, odsToXlsx, openMarkdown } from 'documents.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appReducer, createInitialState } from '../state/reducer.js';
import type { AppState, Diagnostic } from '../state/types.js';
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

describe('openDocumentAtPath for .csv and .svg', () => {
  it('opens a csv read-only as a converted PDF preview, exactly like an xlsx', async () => {
    const path = join(workspace, 'table.csv');
    const bytes = new TextEncoder().encode('name,amount\nalice,1\n');
    await writeFile(path, bytes);

    const doc = await openDocumentAtPath(path);
    if (doc.format !== 'csv') {
      throw new Error(`expected an open csv document, got ${doc.format}`);
    }
    expect(doc.path).toBe(path);
    expect(doc.layout.pages.length).toBeGreaterThan(0);
    expect(doc.bytes).toStrictEqual(bytes);
  });

  it('opens an svg read-only as a converted PDF preview, exactly like an xlsx', async () => {
    const path = join(workspace, 'drawing.svg');
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="10" y="10" width="80" height="80" fill="red"/></svg>');
    await writeFile(path, bytes);

    const doc = await openDocumentAtPath(path);
    if (doc.format !== 'svg') {
      throw new Error(`expected an open svg document, got ${doc.format}`);
    }
    expect(doc.path).toBe(path);
    expect(doc.layout.pages.length).toBeGreaterThan(0);
    expect(doc.bytes).toStrictEqual(bytes);
  });

  it('cannot write either format back to disk -- both open read-only, the same group as .odb and .xlsx', async () => {
    const csvPath = join(workspace, 'table.csv');
    await writeFile(csvPath, new TextEncoder().encode('a,b\n1,2\n'));
    const csvDoc = await openDocumentAtPath(csvPath);
    await expect(saveDocumentTo(csvDoc, join(workspace, 'copy.csv'))).rejects.toThrow(/read-only/);

    const svgPath = join(workspace, 'drawing.svg');
    await writeFile(svgPath, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5"/></svg>'));
    const svgDoc = await openDocumentAtPath(svgPath);
    await expect(saveDocumentTo(svgDoc, join(workspace, 'copy.svg'))).rejects.toThrow(/read-only/);
  });
});

describe('openDocumentAtPath / saveDocumentTo for .md', () => {
  it('opens a real markdown file into a structured MarkdownEditor, edits it through the shared paragraph-family actions, and saves back out as valid, re-parseable markdown containing the edit', async () => {
    const path = join(workspace, 'notes.md');
    await writeFile(path, '# Title\n\nOriginal paragraph.\n');

    const doc = await openDocumentAtPath(path);
    if (doc.format !== 'markdown') {
      throw new Error(`expected an open markdown document, got ${doc.format}`);
    }
    expect(doc.originalText).toBe('# Title\n\nOriginal paragraph.\n');
    expect(doc.editor.paragraphs()).toHaveLength(2);

    let state: AppState = appReducer(createInitialState(), { type: 'OPEN_FILE_SUCCESS', path, doc });
    state = appReducer(state, { type: 'APPEND_PARAGRAPH', text: 'New paragraph', styleId: undefined, alignment: undefined });
    state = appReducer(state, { type: 'TOGGLE_RUN_BOLD', blockIndex: 2, runIndex: 0 });

    const edited = state.openDocument;
    if (edited?.format !== 'markdown') {
      throw new Error(`expected the edited open document to still be markdown, got ${edited?.format}`);
    }
    // originalText stays exactly what the file was opened with, proving it is genuinely decoupled from the live editor -- the same invariant the ':view-source' screen depends on.
    expect(edited.originalText).toBe('# Title\n\nOriginal paragraph.\n');

    const savedPath = join(workspace, 'saved.md');
    await saveDocumentTo(edited, savedPath);
    const written = await readFile(savedPath, 'utf8');

    expect(written).toContain('**New paragraph**');

    // The written bytes are genuinely valid, re-parseable markdown containing the edit -- opened fresh through the same openMarkdown a real reducer.UNDO restore uses.
    const reopened = openMarkdown(written);
    const reopenedParagraphs = reopened.paragraphs();
    expect(reopenedParagraphs).toHaveLength(3);
    expect(reopenedParagraphs[2]?.text).toBe('New paragraph');
    expect(reopenedParagraphs[2]?.runs()[0]?.bold).toBe(true);
  });

  it('reports every diagnostic openMarkdown emits while parsing, through the same onDiagnostic channel exportToPdf already uses', async () => {
    const path = join(workspace, 'fenced.md');
    // A fenced code block's own info string (the language tag after the opening fence) has no ContentParagraph field to survive on -- markdown-codec reports md/code-block-info-string-dropped for it, a real, reachable read-side diagnostic (see documents.js's own README Gotchas table).
    await writeFile(path, '```js\nconst x = 1;\n```\n');

    const diagnostics: Diagnostic[] = [];
    const doc = await openDocumentAtPath(path, {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(doc.format).toBe('markdown');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((diagnostic) => diagnostic.message.toLowerCase().includes('info string'))).toBe(true);
  });
});
