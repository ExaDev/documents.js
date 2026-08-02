// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to this file by vitest.config.ts's "smoke" project) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything.
//
// Now that readMarkdown/writeMarkdown/markdownCodec are real (src/read.ts/src/write.ts/src/codec.ts), this follows pdf-codec's own smoke.test.mjs shape: a representative slice of the public surface checked for presence in both builds, then real read -> write -> reparse assertions run against each build independently, proving the built artifact itself (not just the source under vitest's own transform) round-trips real markdown through readMarkdown/writeMarkdown and through the z.codec() pair.
import { createRequire } from 'node:module';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

// A representative slice of the public surface, not an exhaustive list -- enough to catch a genuinely broken dual build without duplicating src/index.ts's own export list here. Error classes are real invocable functions at runtime (typeof === 'function'), so they're checked here alongside ordinary functions rather than in OBJECTS below.
const FUNCTIONS = ['readMarkdown', 'writeMarkdown', 'NOOP_MARKDOWN_DIAGNOSTIC_SINK', 'MarkdownParseError', 'MarkdownWriteError', 'MarkdownUnsupportedDocumentKindError', 'MarkdownInvalidUtf8Error', 'MarkdownInputTooLargeError', 'MarkdownNestingLimitExceededError'];
const OBJECTS = ['markdownCodec', 'MarkdownBytesSchema', 'MarkdownDiagnosticCodes'];

describe('dist/ exports are present in both builds', () => {
  for (const name of FUNCTIONS) {
    it(`${name} is a function`, () => {
      expect(typeof esm[name]).toBe('function');
      expect(typeof cjs[name]).toBe('function');
    });
  }

  for (const name of OBJECTS) {
    it(`${name} is exported`, () => {
      expect(esm[name]).toBeDefined();
      expect(cjs[name]).toBeDefined();
    });
  }
});

const SAMPLE_MARKDOWN = '# Title\n\nSome **bold** and *italic* text with [a link](http://example.com) and `code`.\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';

describe.each([
  ['ESM', esm],
  ['CJS', cjs],
])('%s artifact behaviour', (_label, api) => {
  describe('readMarkdown then writeMarkdown', () => {
    it('lowers real markdown to a wordprocessing ContentDocument and renders it back to markdown', () => {
      const { document, diagnostics } = api.readMarkdown(SAMPLE_MARKDOWN);
      expect(document.kind).toBe('wordprocessing');
      expect(document.sections[0].blocks.length).toBeGreaterThan(0);
      expect(Array.isArray(diagnostics)).toBe(true);

      const rewritten = api.writeMarkdown(document);
      expect(rewritten).toContain('# Title');
      expect(rewritten).toContain('[a link](http://example.com)');

      // Reparsing the rewritten text should still contain the same real content, proving the round trip isn't merely returning the input unchanged.
      const { document: reparsed } = api.readMarkdown(rewritten);
      expect(reparsed.sections[0].blocks.some((block) => block.kind === 'table')).toBe(true);
    });

    it('throws MarkdownUnsupportedDocumentKindError for a non-wordprocessing ContentDocument', () => {
      const spreadsheet = { kind: 'spreadsheet', formatVersion: 1, metadata: {}, sheets: [] };
      expect(() => api.writeMarkdown(spreadsheet)).toThrow(api.MarkdownUnsupportedDocumentKindError);
    });
  });

  describe('markdownCodec', () => {
    it('decodes real UTF-8 bytes to a ContentDocument and encodes back to bytes', () => {
      const bytes = new TextEncoder().encode(SAMPLE_MARKDOWN);
      expect(api.MarkdownBytesSchema.safeParse(bytes).success).toBe(true);
      expect(api.MarkdownBytesSchema.safeParse(new Uint8Array([0xff, 0xfe, 0xfd])).success).toBe(false);

      const document = z.decode(api.markdownCodec, bytes);
      expect(document.kind).toBe('wordprocessing');

      const encoded = z.encode(api.markdownCodec, document);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
      expect(new TextDecoder().decode(encoded)).toContain('Title');
    });
  });
});
