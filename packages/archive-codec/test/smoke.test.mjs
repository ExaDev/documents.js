// Smoke test: the built dist/ artifact loads and works under both ESM and CJS, and every module the exports map's `./*` wildcard advertises genuinely exists in dist. Run only via `pnpm test:smoke` (turbo's _build builds dist first) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. The deep-import half is the guard #745 exists for: tsdown.config.ts builds one dist file per src module (root: 'src', the same layout ooxml.js ships), and this suite fails loudly the moment that stops being true -- publint and attw both pass a wildcard whose targets are missing, so dist actually serving the advertised subpaths is provable only by loading them.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

// One representative export per barrel module, so the "both builds expose the same surface" check below is anchored to real names rather than only typeof checks on the namespace.
const BARREL_FUNCTIONS = [
  'zipPackage',
  'unzipPackage',
  'detectArchiveFormat',
  'isZipArchive',
  'walkArchive',
  'isCompoundFile',
  'readCompoundFile',
  'writeCompoundFile',
  'readOlePackage',
  'writeOlePackage',
  'readPropertySetStream',
  'writePropertySetStream',
  'readSummaryInformation',
  'writeSummaryInformationStream',
  'summaryInformationToLayoutMetadata',
  'layoutMetadataToSummaryInformation',
  'hasSummaryInformationFields',
];
const BARREL_CONSTANTS = [
  'MAX_WALK_DEPTH',
  'MAX_WALK_TOTAL_BYTES',
  'MAX_CFB_TOTAL_STREAM_BYTES',
  'FMTID_SUMMARY_INFORMATION',
];
const BARREL_CLASSES = [
  'ArchiveWalkLimitError',
  'CompoundFileFormatError',
  'CompoundFileWriteError',
  'OlePackageFormatError',
  'OlePackageWriteError',
  'PropertySetFormatError',
  'PropertySetWriteError',
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

// The module table in this package's README names each of these as a module, and package.json's `./*` wildcard maps them onto ./dist/*.js -- so each must exist in dist in both module systems and export its own surface. A missing file here is exactly the #745 defect (ERR_MODULE_NOT_FOUND on `import('archive-codec/zip/walk')`), which neither publint nor attw catches.
describe('dist/ deep imports resolve for every advertised module, in both builds', () => {
  const DEEP_MODULES = [
    { path: '../dist/zip/container.js', exports: ['zipPackage', 'unzipPackage'] },
    { path: '../dist/zip/detect.js', exports: ['detectArchiveFormat', 'isZipArchive'] },
    { path: '../dist/zip/walk.js', exports: ['walkArchive', 'MAX_WALK_DEPTH'] },
    { path: '../dist/cfb/detect.js', exports: ['isCompoundFile'] },
    { path: '../dist/cfb/read.js', exports: ['readCompoundFile', 'MAX_CFB_TOTAL_STREAM_BYTES'] },
    { path: '../dist/cfb/write.js', exports: ['writeCompoundFile', 'CompoundFileWriteError'] },
    {
      path: '../dist/cfb/ole-package.js',
      exports: ['readOlePackage', 'writeOlePackage'],
    },
    { path: '../dist/oleps/read.js', exports: ['readPropertySetStream', 'PropertySetFormatError'] },
    { path: '../dist/oleps/write.js', exports: ['writePropertySetStream', 'PropertySetWriteError'] },
    {
      path: '../dist/oleps/summary-information.js',
      exports: ['readSummaryInformation', 'writeSummaryInformationStream', 'FMTID_SUMMARY_INFORMATION'],
    },
    {
      path: '../dist/oleps/layout-metadata.js',
      exports: ['summaryInformationToLayoutMetadata', 'layoutMetadataToSummaryInformation', 'hasSummaryInformationFields'],
    },
    { path: '../dist/magic.js', exports: [] },
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

describe('dist/ end-to-end: both builds round-trip a real archive', () => {
  it('zipPackage -> isZipArchive/detectArchiveFormat/isCompoundFile -> walkArchive agrees across ESM and CJS', () => {
    const content = new TextEncoder().encode('smoke entry for archive-codec');
    const zipBytes = esm.zipPackage([['nested/inner.txt', { bytes: content }]]);
    expect(esm.isZipArchive(zipBytes)).toBe(true);
    expect(esm.detectArchiveFormat(zipBytes)).toBe('zip');
    expect(esm.isCompoundFile(zipBytes)).toBe(false);

    const esmEntries = [...esm.walkArchive(zipBytes)];
    expect(esmEntries.length).toBe(1);
    expect(esmEntries[0]?.path).toBe('nested/inner.txt');
    expect(esmEntries[0]?.ancestors).toEqual([]);

    const cjsEntries = [...cjs.walkArchive(cjs.zipPackage([['nested/inner.txt', { bytes: content }]]))];
    expect(cjsEntries.map((entry) => entry.path)).toEqual(['nested/inner.txt']);
    expect(cjsEntries[0]?.bytes).toEqual(content);
    expect(cjs.detectArchiveFormat(zipBytes)).toBe('zip');
  });

  it('writeCompoundFile -> isCompoundFile/detectArchiveFormat -> readCompoundFile agrees across ESM and CJS', () => {
    // The compound-file half of the same end-to-end check, and the one that needs both directions built: a writer whose output only its own build can read would pass every deep-import check above and still be broken.
    const small = new TextEncoder().encode('smoke stream for archive-codec');
    const large = new Uint8Array(5000).fill(0x41);
    const built = esm.writeCompoundFile([
      { path: 'Storage/Small', bytes: small },
      { path: 'Large', bytes: large },
    ]);
    expect(esm.isCompoundFile(built)).toBe(true);
    expect(esm.detectArchiveFormat(built)).toBe('cfb');
    expect(esm.isZipArchive(built)).toBe(false);

    const esmStreams = esm.readCompoundFile(built);
    expect(esmStreams.map((entry) => entry.path).sort()).toEqual(['Large', 'Storage/Small']);
    expect(esmStreams.find((entry) => entry.path === 'Storage/Small')?.bytes).toEqual(small);

    const cjsStreams = cjs.readCompoundFile(cjs.writeCompoundFile([['Large', large]].map(([path, bytes]) => ({ path, bytes }))));
    expect(cjsStreams.map((entry) => entry.path)).toEqual(['Large']);
    expect(cjsStreams[0]?.bytes).toEqual(large);
  });

  it('writeSummaryInformationStream -> readSummaryInformation agrees across ESM and CJS', () => {
    // The property-set half of the same end-to-end check: a writer whose stream only its own build can parse back would pass every deep-import check above and still be broken.
    const metadata = { title: 'Smoke title', author: 'archive-codec', keywords: ['a', 'b'] };
    const esmRead = esm.readSummaryInformation(esm.writeSummaryInformationStream(metadata));
    expect(esmRead.title).toBe(metadata.title);
    expect(esmRead.author).toBe(metadata.author);
    expect(esmRead.keywords).toEqual(metadata.keywords);

    const cjsRead = cjs.readSummaryInformation(cjs.writeSummaryInformationStream(metadata));
    expect(cjsRead.title).toBe(metadata.title);
    expect(cjsRead.author).toBe(metadata.author);
    expect(cjsRead.keywords).toEqual(metadata.keywords);
  });

  it('writeOlePackage -> readOlePackage agrees across ESM and CJS', () => {
    // The OLE Package half of the same end-to-end check: a writer whose stream only its own build can unwrap back would pass every deep-import check above and still be broken.
    const pkg = { label: 'smoke.bin', sourcePath: 'C:\\smoke.bin', tempPath: 'C:\\temp\\smoke.bin', fileBytes: new TextEncoder().encode('smoke package payload') };

    const esmParsed = esm.readOlePackage(esm.writeOlePackage(pkg));
    expect(esmParsed.label).toBe(pkg.label);
    expect(esmParsed.fileBytes).toEqual(pkg.fileBytes);

    const cjsParsed = cjs.readOlePackage(cjs.writeOlePackage(pkg));
    expect(cjsParsed.label).toBe(pkg.label);
    expect(cjsParsed.fileBytes).toEqual(pkg.fileBytes);
  });
});
