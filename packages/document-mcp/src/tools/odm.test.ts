import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { LayoutDocument, LayoutText } from 'documents.js';
import { base64ToBytes, bytesToBase64, readPdf } from 'documents.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../server';
import { chapterOdtBytes, odmBytes } from '../test-support/odm-fixture';
import { OdmToPdfOutputSchema } from './odm';

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- not the tool callback in isolation -- so this proves the wiring: that `odm_to_pdf` is registered under that name on the server createServer() returns, that it reads a real .odm plus its chapter .odt files through documents.js's own odmToPdf, and that a real PDF (or a named OdmUnresolvedSectionError) reaches the caller.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({ name: 'odm-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: async () => client.close() };
}

function pageText(layout: LayoutDocument, pageIndex: number): string {
  const page = layout.pages[pageIndex];
  if (page === undefined) {
    return '';
  }
  return page.items
    .filter((item): item is LayoutText => item.kind === 'text')
    .map((item) => item.text)
    .join(' ');
}

describe('odm_to_pdf', () => {
  let workspace: string;

  let pair: ConnectedPair;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'document-mcp-odm-'));
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
    await rm(workspace, { recursive: true, force: true });
  });

  it('converts a two-chapter master document via explicit chapters overrides, both chapters passed as inline base64', async () => {
    const master = odmBytes([
      { name: 'Chapter1', href: '../chapter1.odt' },
      { name: 'Chapter2', href: '../chapter2.odt' },
    ]);

    const result = await pair.client.callTool({
      name: 'odm_to_pdf',
      arguments: {
        source: { bytesBase64: bytesToBase64(master) },
        chapters: [
          { href: '../chapter1.odt', source: { bytesBase64: bytesToBase64(chapterOdtBytes('Chapter One', 'Body of chapter one.')), format: 'odt' } },
          { href: '../chapter2.odt', source: { bytesBase64: bytesToBase64(chapterOdtBytes('Chapter Two', 'Body of chapter two.')), format: 'odt' } },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = OdmToPdfOutputSchema.parse(result.structuredContent);
    if (!('bytesBase64' in structured)) {
      throw new Error('expected an inline bytesBase64 result');
    }
    const layout = readPdf(base64ToBytes(structured.bytesBase64));
    expect(layout.pages).toHaveLength(2);
    expect(pageText(layout, 0)).toContain('Chapter One');
    expect(pageText(layout, 0)).toContain('Body of chapter one.');
    expect(pageText(layout, 0)).not.toContain('Chapter Two');
    expect(pageText(layout, 1)).toContain('Chapter Two');
    expect(pageText(layout, 1)).toContain('Body of chapter two.');
  });

  it("resolves chapters from chaptersDir, matched by each href's own basename, and writes the result to outputPath", async () => {
    const master = odmBytes([
      { name: 'Chapter1', href: '../chapter1.odt' },
      { name: 'Chapter2', href: '../chapter2.odt' },
    ]);
    const masterPath = join(workspace, 'book.odm');
    await writeFile(masterPath, master);

    const chaptersDir = join(workspace, 'chapters');
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(join(chaptersDir, 'chapter1.odt'), chapterOdtBytes('Dir Chapter One', 'Body one from chaptersDir.'));
    await writeFile(join(chaptersDir, 'chapter2.odt'), chapterOdtBytes('Dir Chapter Two', 'Body two from chaptersDir.'));

    const outputPath = join(workspace, 'book.pdf');
    const result = await pair.client.callTool({
      name: 'odm_to_pdf',
      arguments: { source: { path: masterPath }, chaptersDir, output: { outputPath } },
    });

    expect(result.isError).toBeFalsy();
    const structured = OdmToPdfOutputSchema.parse(result.structuredContent);
    if (!('path' in structured)) {
      throw new Error('expected a written-path result');
    }
    expect(structured.path).toBe(outputPath);
    expect(structured.byteLength).toBeGreaterThan(0);

    const layout = readPdf(new Uint8Array(await readFile(outputPath)));
    expect(layout.pages).toHaveLength(2);
    expect(pageText(layout, 0)).toContain('Dir Chapter One');
    expect(pageText(layout, 1)).toContain('Dir Chapter Two');
  });

  it('prefers an explicit chapters override over chaptersDir for the same href', async () => {
    const master = odmBytes([{ name: 'Chapter1', href: '../chapter1.odt' }]);

    const chaptersDir = join(workspace, 'chapters');
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(join(chaptersDir, 'chapter1.odt'), chapterOdtBytes('From Directory', 'Should be shadowed.'));

    const result = await pair.client.callTool({
      name: 'odm_to_pdf',
      arguments: {
        source: { bytesBase64: bytesToBase64(master) },
        chapters: [{ href: '../chapter1.odt', source: { bytesBase64: bytesToBase64(chapterOdtBytes('From Override', 'Should win.')), format: 'odt' } }],
        chaptersDir,
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = OdmToPdfOutputSchema.parse(result.structuredContent);
    if (!('bytesBase64' in structured)) {
      throw new Error('expected an inline bytesBase64 result');
    }
    const layout = readPdf(base64ToBytes(structured.bytesBase64));
    expect(pageText(layout, 0)).toContain('From Override');
    expect(pageText(layout, 0)).not.toContain('From Directory');
  });

  it('returns an isError result naming every unresolved href when neither chapters nor chaptersDir resolves them', async () => {
    const master = odmBytes([
      { name: 'Chapter1', href: '../missing-a.odt' },
      { name: 'Chapter2', href: '../missing-b.odt' },
    ]);

    const result = await pair.client.callTool({ name: 'odm_to_pdf', arguments: { source: { bytesBase64: bytesToBase64(master) } } });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toStrictEqual({ hrefs: ['../missing-a.odt', '../missing-b.odt'] });
    const [block] = result.content;
    if (block?.type !== 'text') {
      throw new Error('expected a text content block');
    }
    expect(block.text).toContain('../missing-a.odt');
    expect(block.text).toContain('../missing-b.odt');
  });
});
