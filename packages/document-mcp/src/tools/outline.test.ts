import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { bytesToBase64, createOds, encodeMarkdownText } from 'documents.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../server';

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- proving `outline_document` is registered under that name, reads a real source document through the converter port, and answers with document-outline.js's buildOutline TOC projection as structured JSON an MCP client can render directly.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({ name: 'outline-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: async () => client.close() };
}

describe('outline_document', () => {
  let pair: ConnectedPair;

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  it('outlines a markdown document heading, list, and leaf structure exactly', async () => {
    // encodeMarkdownText is the same encoder document-cli's stdin path uses; the fixture exercises every wordprocessing grouping signal -- two heading levels, a list nested inside the deeper heading, plain paragraphs as leaves -- so the assertion pins the whole projected shape, not a fragment of it.
    const markdown = '# Chapter One\n\nIntro.\n\n## Section A\n\n- item one\n  - nested item\n\n# Chapter Two\n\nClosing.\n';
    const result = await pair.client.callTool({
      name: 'outline_document',
      arguments: { source: { bytesBase64: bytesToBase64(encodeMarkdownText(markdown)), format: 'markdown' } },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      sourceFormat: 'markdown',
      kind: 'wordprocessing',
      outline: [
        {
          text: 'Chapter One',
          level: 1,
          children: [
            { kind: 'paragraph', text: 'Intro.' },
            {
              text: 'Section A',
              level: 2,
              children: [{ text: 'item one', level: 0, children: [{ text: 'nested item', level: 1, children: [] }] }],
            },
          ],
        },
        { text: 'Chapter Two', level: 1, children: [{ kind: 'paragraph', text: 'Closing.' }] },
      ],
    });
  });

  it('outlines a spreadsheet as one group per sheet, labelled with the sheet name', async () => {
    const editor = createOds();
    const sheet = editor.sheets()[0];
    if (sheet === undefined) {
      throw new Error('createOds() did not produce a default sheet');
    }
    sheet.cell(0, 0).value = { kind: 'string', value: 'Cells are addressable data, not outline content' };

    const result = await pair.client.callTool({ name: 'outline_document', arguments: { source: { bytesBase64: bytesToBase64(editor.toBytes()), format: 'ods' } } });

    expect(result.isError).toBeFalsy();
    // A sheet's cells ride the sheet node and never appear in the outline -- only the sheet group itself, empty here because the sheet carries no images or embedded objects.
    expect(result.structuredContent).toEqual({ sourceFormat: 'ods', kind: 'spreadsheet', outline: [{ text: 'Sheet1', level: 1, children: [] }] });
  });

  it('answers an isError result for source bytes no conversion can read', async () => {
    const result = await pair.client.callTool({
      name: 'outline_document',
      arguments: { source: { bytesBase64: bytesToBase64(new TextEncoder().encode('this is not a docx')), format: 'docx' } },
    });

    expect(result.isError).toBe(true);
    // The docx reader's own failure text surfaces verbatim -- 'invalid zip data', what fflate says for bytes that are not a zip at all -- so the caller learns what actually failed to read rather than a generic wrapper message.
    const [block] = result.content;
    expect(block?.type === 'text' ? block.text : undefined).toContain('invalid zip data');
  });

  it('is advertised by the server alongside the other tools', async () => {
    const listed = await pair.client.listTools();
    const tool = listed.tools.find((candidate) => candidate.name === 'outline_document');
    expect(tool?.description).toContain('table of contents');
  });
});
