// Smoke test: the built dist/ artifact loads and works under both ESM and CJS, and every module the exports map's `./*` wildcard advertises genuinely exists in dist. Run only via `pnpm test:smoke` (turbo's _build builds dist first) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. The deep-import half matters because publint and attw both pass a wildcard whose targets are missing: dist actually serving the advertised subpaths is provable only by loading them.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

// One representative export per barrel module, so the "both builds expose the same surface" check is anchored to real names rather than only typeof checks on the namespace.
const BARREL_FUNCTIONS = [
  'readRecords',
  'readXLUnicodeString',
  'readShortXLUnicodeString',
  'readRichExtendedString',
  'decodeRkNumber',
  'errorTextOf',
  'groupRecords',
  'splitSubstreams',
  'readWorkbookGlobals',
  'formatCodeOf',
  'readSheetRecords',
  'classifyNumberFormat',
  'serialToIsoDate',
  'serialToIsoTime',
  'serialToIsoDateTime',
  'twipsToPoints',
  'columnWidthToPoints',
  'readWorkbookStreams',
  'layoutMetadataToSummaryInformation',
  'isXlsFile',
  'readXlsContent',
  'readXls',
];
const BARREL_CONSTANTS = [
  'RECORD_BOF',
  'RECORD_EOF',
  'RECORD_CONTINUE',
  'MAX_RECORD_DATA_SIZE',
  'BIFF8_VERSION',
  'BUILTIN_NUMBER_FORMATS',
  'SUMMARY_INFORMATION_STREAM',
];
const BARREL_CLASSES = ['BiffFormatError', 'BlockCursor'];

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

// The architecture section of this package's README names each of these as a module, and package.json's `./*` wildcard maps them onto ./dist/*.js -- so each must exist in dist in both module systems and export its own surface.
describe('dist/ deep imports resolve for every advertised module, in both builds', () => {
  const DEEP_MODULES = [
    { path: '../dist/biff/records.js', exports: ['readRecords', 'BiffFormatError'] },
    { path: '../dist/biff/record-types.js', exports: ['RECORD_BOF', 'RECORD_EOF'] },
    { path: '../dist/biff/cursor.js', exports: ['BlockCursor'] },
    { path: '../dist/biff/strings.js', exports: ['readXLUnicodeString'] },
    { path: '../dist/biff/rk.js', exports: ['decodeRkNumber'] },
    { path: '../dist/biff/errors.js', exports: ['errorTextOf'] },
    { path: '../dist/biff/substreams.js', exports: ['groupRecords', 'splitSubstreams'] },
    { path: '../dist/workbook/globals.js', exports: ['readWorkbookGlobals'] },
    { path: '../dist/workbook/sheet.js', exports: ['readSheetRecords'] },
    {
      path: '../dist/workbook/print-names.js',
      exports: ['readPrintNames', 'writePrintNameRecords'],
    },
    {
      path: '../dist/biff/print-setup.js',
      exports: ['pageSizeFromSetup', 'paperSelectionFor'],
    },
    { path: '../dist/serial.js', exports: ['serialToIsoDate'] },
    { path: '../dist/units.js', exports: ['twipsToPoints'] },
    { path: '../dist/container.js', exports: ['readWorkbookStreams', 'isXlsFile', 'SUMMARY_INFORMATION_STREAM'] },
    { path: '../dist/content.js', exports: ['readXlsContent', 'readXls'] },
    {
      path: '../dist/metadata.js',
      exports: ['layoutMetadataToSummaryInformation'],
    },
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

describe('dist/ end-to-end: both builds decode the same values', () => {
  it('agrees on the packed-numeric, number-format, and serial decoders', () => {
    // 0x3FF80000 is the top 32 bits of 1.5, the RkNumber case whose flag bits sit exactly where the double's own bits 32 and 33 live.
    expect(esm.decodeRkNumber(0x3ff80000)).toBe(1.5);
    expect(cjs.decodeRkNumber(0x3ff80000)).toBe(1.5);

    expect(esm.classifyNumberFormat('[$-809]0.00%').kind).toBe('percentage');
    expect(cjs.classifyNumberFormat('[$-809]0.00%').kind).toBe('percentage');

    // Serial 60 is the 1900 system's phantom leap day, which names no real date.
    expect(esm.serialToIsoDate(60, false)).toBeUndefined();
    expect(cjs.serialToIsoDate(60, false)).toBeUndefined();
    expect(esm.serialToIsoDate(61, false)).toBe('1900-03-01');
  });

  it('reads a record stream and rejects a non-workbook, identically in both builds', () => {
    // A BOF record declaring BIFF8 and the workbook substream, framed as [MS-XLS] 2.1.4 specifies.
    const stream = new Uint8Array([
      0x09, 0x08, 0x10, 0x00, 0x00, 0x06, 0x05, 0x00, 0xbb, 0x0d, 0xcc, 0x07, 0x41, 0x00, 0x00,
      0x00, 0x06, 0x02, 0x00, 0x00,
    ]);

    expect(esm.readRecords(stream)[0].type).toBe(esm.RECORD_BOF);
    expect(cjs.readRecords(stream)[0].type).toBe(cjs.RECORD_BOF);

    // A ZIP archive (what a .xlsx is) is not a workbook this package reads.
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(esm.isXlsFile(zipMagic)).toBe(false);
    expect(cjs.isXlsFile(zipMagic)).toBe(false);
  });
});
