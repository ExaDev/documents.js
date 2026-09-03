// Smoke test: the built dist/ artifact loads and works under both ESM and CJS, and every module the exports map's `./*` wildcard advertises genuinely exists in dist. Run only via `pnpm test:smoke` (turbo's _build builds dist first) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. The deep-import half matters because publint and attw both pass a wildcard whose targets are missing: dist actually serving the advertised subpaths is provable only by loading them.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

const BARREL_FUNCTIONS = [
  'readWpd',
  'readWpdContent',
  'openWpdDocument',
  'readFileHeader',
  'readPrefixPackets',
  'readTypefaceName',
  'tokeniseDocumentArea',
  'decodeWpCharacter',
  'decodeSingleByteCharacter',
  'decodeAttributeByte',
];
const BARREL_CONSTANTS = [
  'WPD_FILE_ID',
  'WPD_MEDIA_TYPE',
  'WPD_FILE_EXTENSION',
  'WpdDiagnosticCodes',
  'WpdAttribute',
  'wpdContentCodec',
  'WpdBytesSchema',
];
const BARREL_CLASSES = [
  'WpdFormatError',
  'WpdEncryptedDocumentError',
  'WpdNotAWordPerfectFileError',
  'WpdUnsupportedVersionError',
];

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

// The module table in this package's README names each of these, and package.json's `./*` wildcard maps them onto ./dist/*.js -- so each must exist in dist in both module systems and export its own surface. The paths are written out in full rather than composed from a variable, because a bundler cannot resolve a dynamic import whose variable spans more than one path segment.
describe('dist/ deep imports resolve for every advertised module, in both builds', () => {
  const DEEP_MODULES = [
    { path: '../dist/read.js', exports: ['readWpd', 'readWpdContent'] },
    { path: '../dist/codec.js', exports: ['wpdContentCodec', 'WpdBytesSchema'] },
    { path: '../dist/format.js', exports: ['WPD_MEDIA_TYPE', 'WPD_FILE_EXTENSION'] },
    { path: '../dist/diagnostics.js', exports: ['WpdDiagnosticCodes'] },
    { path: '../dist/errors.js', exports: ['WpdFormatError'] },
    { path: '../dist/container/container.js', exports: ['openWpdDocument'] },
    { path: '../dist/container/header.js', exports: ['readFileHeader', 'WPD_FILE_ID'] },
    { path: '../dist/container/prefix.js', exports: ['readPrefixPackets', 'readTypefaceName'] },
    { path: '../dist/stream/tokenise.js', exports: ['tokeniseDocumentArea'] },
    { path: '../dist/stream/characters.js', exports: ['decodeWpCharacter'] },
    { path: '../dist/stream/eol.js', exports: ['eolMappingForSubfunction'] },
    { path: '../dist/stream/attributes.js', exports: ['decodeAttributeByte', 'WpdAttribute'] },
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

describe('the built reader parses a WordPerfect document', () => {
  // A minimal conforming WordPerfect 6.x file, built inline rather than through src/test-support (which is not part of dist): a 16-byte header, a 496-byte extended header, an index area holding only its index header, and a document area of "Hi" followed by a Hard EOL.
  function minimalWpdFile() {
    const documentArea = [0x48, 0x69, 0xcc];
    const indexAreaSize = 14;
    const documentAreaStart = 512 + indexAreaSize;
    const bytes = new Uint8Array(documentAreaStart + documentArea.length);
    bytes.set([0xff, 0x57, 0x50, 0x43], 0);
    new DataView(bytes.buffer).setUint32(4, documentAreaStart, true);
    bytes[8] = 1;
    bytes[9] = 0x0a;
    bytes[10] = 2;
    bytes[11] = 1;
    new DataView(bytes.buffer).setUint16(14, 512, true);
    new DataView(bytes.buffer).setUint32(20, bytes.length, true);
    bytes[512] = 2;
    new DataView(bytes.buffer).setUint16(514, 1, true);
    bytes.set(documentArea, documentAreaStart);
    return bytes;
  }

  it('reads a paragraph out of the built artifact', () => {
    for (const build of [esm, cjs]) {
      const document = build.readWpdContent(minimalWpdFile());
      expect(document.kind).toBe('wordprocessing');
      expect(document.sections[0].blocks[0].runs[0].text).toBe('Hi');
    }
  });
});
