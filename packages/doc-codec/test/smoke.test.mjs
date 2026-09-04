// Smoke test: the built dist/ artifact loads and works under both ESM and CJS, and every module the exports map's `./*` wildcard advertises genuinely exists in dist. Run only via `pnpm test:smoke` (turbo's _build builds dist first) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. The deep-import half mirrors archive-codec's own smoke suite: tsdown.config.ts builds one dist file per src module (root: 'src'), and this suite fails loudly the moment a module stops being served at its advertised subpath -- neither publint nor attw catches a wildcard whose targets are missing.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

// One representative export per barrel module, so the "both builds expose the same surface" check below is anchored to real names rather than only typeof checks on the namespace.
const BARREL_FUNCTIONS = [
  'readDocContent',
  'readDocStreams',
  'isDocBytes',
  'parseFib',
  'tableStreamName',
  'parseClx',
  'characterOffset',
  'readTextRange',
  'decodeSprm',
  'readGrpprl',
  'operandSize',
  'parseChpxFkp',
  'parsePapxFkp',
  'applyCharacterSprms',
  'applyParagraphSprms',
  'parseStsh',
  'headingLevelFromIstd',
  'parsePlc',
  'findLargestAtMost',
  'endsParagraph',
  'layoutMetadataToSummaryInformation',
];
const BARREL_CONSTANTS = [
  'FIB_W_IDENT',
  'FIB_FC_LCB_BLOB_OFFSET',
  'FKP_PAGE_SIZE',
  'COMPRESSED_CHARACTER_MAP',
  'PARAGRAPH_MARK',
  'WORD_DOCUMENT_STREAM',
  'SUMMARY_INFORMATION_STREAM',
  'SGC',
  'STK',
];
const BARREL_CLASSES = ['DocFormatError', 'DocUnsupportedError', 'PropertyBinTable'];

describe('dist/ barrel exports are present in both builds', () => {
  for (const name of BARREL_FUNCTIONS) {
    it(`${name} is a function`, () => {
      expect(typeof esm[name]).toBe('function');
      expect(typeof cjs[name]).toBe('function');
    });
  }

  for (const name of BARREL_CONSTANTS) {
    it(`${name} is exported`, () => {
      expect(esm[name]).toBeDefined();
      expect(cjs[name]).toBeDefined();
    });
  }

  for (const name of BARREL_CLASSES) {
    it(`${name} is a class`, () => {
      expect(typeof esm[name]).toBe('function');
      expect(typeof cjs[name]).toBe('function');
    });
  }
});

// The module table in this package's README names each of these, and package.json's `./*` wildcard maps them onto ./dist/*.js -- so each must exist in dist in both module systems and export its own surface.
describe('dist/ deep imports resolve for every advertised module, in both builds', () => {
  const DEEP_MODULES = [
    { path: '../dist/errors.js', exports: ['DocFormatError', 'DocUnsupportedError'] },
    { path: '../dist/bytes.js', exports: ['readUint16LE', 'slice'] },
    { path: '../dist/plc.js', exports: ['parsePlc', 'findLargestAtMost'] },
    { path: '../dist/detect.js', exports: ['isDocBytes', 'WORD_DOCUMENT_STREAM', 'SUMMARY_INFORMATION_STREAM'] },
    {
      path: '../dist/metadata.js',
      exports: ['layoutMetadataToSummaryInformation'],
    },
    { path: '../dist/fib/offsets.js', exports: ['FIB_W_IDENT', 'FIB_FC_LCB_BLOB_OFFSET'] },
    { path: '../dist/fib/fib.js', exports: ['parseFib', 'tableStreamName'] },
    { path: '../dist/text/piece-table.js', exports: ['parseClx', 'characterOffset'] },
    { path: '../dist/text/characters.js', exports: ['readTextRange', 'COMPRESSED_CHARACTER_MAP'] },
    { path: '../dist/text/special.js', exports: ['PARAGRAPH_MARK', 'endsParagraph'] },
    { path: '../dist/prop/sprm.js', exports: ['decodeSprm', 'readGrpprl', 'SGC'] },
    { path: '../dist/prop/fkp.js', exports: ['parseChpxFkp', 'parsePapxFkp', 'FKP_PAGE_SIZE'] },
    { path: '../dist/prop/chp.js', exports: ['applyCharacterSprms'] },
    { path: '../dist/prop/pap.js', exports: ['applyParagraphSprms'] },
    { path: '../dist/prop/sep.js', exports: ['readSectionProperties'] },
    { path: '../dist/style/stsh.js', exports: ['parseStsh', 'headingLevelFromIstd', 'STK'] },
    { path: '../dist/list/numbering.js', exports: ['readNumberingDefinitions'] },
    { path: '../dist/read.js', exports: ['readDocContent', 'readDocStreams'] },
  ];

  for (const module of DEEP_MODULES) {
    it(`${module.path.replace('../dist/', '').replace('.js', '')} loads in both builds`, async () => {
      const esmModule = await import(module.path);
      const cjsPath = module.path.replace('.js', '.cjs');
      const cjsModule = require(cjsPath);
      for (const name of module.exports) {
        expect(esmModule[name], `${module.path} must export ${name} (ESM)`).toBeDefined();
        expect(cjsModule[name], `${cjsPath} must export ${name} (CJS)`).toBeDefined();
      }
    });
  }
});

// [MS-DOC] 2.9.6's own worked example, byte for byte -- the one fixture that needs no test-support helper, since test-support is deliberately absent from dist.
const SPEC_EXAMPLE_CLX = new Uint8Array([
  0x02,
  0x28, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x06, 0x00, 0x00, 0x00,
  0x0d, 0x00, 0x00, 0x00,
  0x0e, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x22, 0x0c, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x08, 0x00, 0x40, 0x00, 0x00,
  0x00, 0x00, 0x0e, 0x08, 0x00, 0x40, 0x00, 0x00,
]);

describe('dist/ end-to-end: both builds parse the specification\'s own example piece table', () => {
  it('recovers the example\'s three pieces identically in ESM and CJS', () => {
    for (const build of [esm, cjs]) {
      const table = build.parseClx(SPEC_EXAMPLE_CLX);
      expect(table.pieces.map((piece) => piece.fc)).toEqual([0x0c22, 0x0800, 0x080e]);
      expect(table.pieces.map((piece) => piece.compressed)).toEqual([false, true, true]);
      expect(table.lastCp).toBe(14);
      // The compressed piece's real byte offset is its stored value halved, as the example itself states.
      expect(build.characterOffset(table.pieces[1], 6)).toBe(0x0400);
    }
  });

  it('rejects bytes that are not a compound file at all', () => {
    expect(esm.isDocBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    expect(cjs.isDocBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });
});
