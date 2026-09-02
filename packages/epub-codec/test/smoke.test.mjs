// Smoke test: the built dist/ artifact loads and works under both ESM and CJS, and every module the exports map's `./*` wildcard advertises genuinely exists in dist. Run only via `pnpm test:smoke` (turbo's _build builds dist first) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. The deep-import half mirrors archive-codec's own smoke suite: tsdown.config.ts builds one dist file per src module (root: 'src'), and this suite fails loudly the moment a module stops being served at its advertised subpath -- neither publint nor attw catches a wildcard whose targets are missing.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

const BARREL_FUNCTIONS = [
  'zipPackage',
  'unzipPackage',
  'readEpub',
  'readEpubContent',
  'writeEpub',
  'writeEpubContent',
  'parseOpf',
  'writeOpf',
  'resolveOpfPath',
  'readXhtmlBody',
  'writeXhtmlBody',
  'readNav3TocHrefs',
  'readNcxHrefs',
  'writeNav3Document',
  'navMatchesSpine',
  'parseXml',
  'buildXml',
  'bytesToBase64',
  'base64ToBytes',
  'detectImageFormat',
  'readImageDimensions',
];
const BARREL_CONSTANTS = ['EPUB_MIME_TYPE', 'OCF_CONTAINER_PATH', 'OCF_MIMETYPE_PATH'];
const BARREL_CLASSES = [
  'EpubParseError',
  'EpubInvalidMimetypeError',
  'EpubInvalidContainerError',
  'EpubInvalidOpfError',
  'EpubEmptySpineError',
  'EpubWriteError',
  'EpubUnsupportedDocumentKindError',
  'EpubUnbalancedConstructMarkersError',
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

describe('dist/ deep imports resolve for every advertised module, in both builds', () => {
  const DEEP_MODULES = [
    { path: '../dist/zip.js', exports: ['zipPackage', 'unzipPackage'] },
    { path: '../dist/format.js', exports: ['EPUB_MIME_TYPE'] },
    { path: '../dist/read.js', exports: ['readEpub', 'readEpubContent'] },
    { path: '../dist/write.js', exports: ['writeEpub', 'writeEpubContent'] },
    { path: '../dist/codec.js', exports: ['epubCodec', 'epubContentCodec'] },
    { path: '../dist/path.js', exports: ['dirname', 'resolvePackagePath'] },
    { path: '../dist/diagnostics.js', exports: ['EpubParseError'] },
    { path: '../dist/ocf/container.js', exports: ['resolveOpfPath'] },
    { path: '../dist/ocf/write.js', exports: ['writeContainerXml'] },
    { path: '../dist/opf/parse.js', exports: ['parseOpf'] },
    { path: '../dist/opf/write.js', exports: ['writeOpf'] },
    { path: '../dist/opf/metadata.js', exports: ['readOpfMetadata'] },
    { path: '../dist/xhtml/read.js', exports: ['readXhtmlBody'] },
    { path: '../dist/xhtml/write.js', exports: ['writeXhtmlBody'] },
    { path: '../dist/xhtml/inline.js', exports: ['buildInlineRuns'] },
    { path: '../dist/xhtml/footnote.js', exports: ['isFootnoteAside'] },
    { path: '../dist/xhtml/list-id.js', exports: ['mintListNumId', 'parseListNumId'] },
    { path: '../dist/nav/nav3.js', exports: ['readNav3TocHrefs'] },
    { path: '../dist/nav/ncx.js', exports: ['readNcxHrefs'] },
    { path: '../dist/nav/reconcile.js', exports: ['navMatchesSpine'] },
    { path: '../dist/nav/write.js', exports: ['writeNav3Document'] },
    { path: '../dist/xml/parse.js', exports: ['parseXml'] },
    { path: '../dist/xml/build.js', exports: ['buildXml'] },
    { path: '../dist/xml/query.js', exports: ['rootElement', 'attrValue'] },
    { path: '../dist/xml/entities.js', exports: ['decodeEntities', 'encodeEntities'] },
    { path: '../dist/util/base64.js', exports: ['bytesToBase64', 'base64ToBytes'] },
    { path: '../dist/image/dimensions.js', exports: ['detectImageFormat', 'readImageDimensions'] },
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

describe('dist/ end-to-end: both builds round-trip a real EPUB', () => {
  it('writeEpubContent -> readEpubContent agrees across ESM and CJS', () => {
    const document = {
      kind: 'wordprocessing',
      metadata: { title: 'Smoke Test' },
      sections: [
        {
          pageSize: { widthPt: 595.28, heightPt: 841.89 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: 'paragraph', runs: [{ text: 'Hello, smoke test.' }] }],
        },
      ],
    };

    const esmBytes = esm.writeEpubContent(document);
    const esmResult = esm.readEpubContent(esmBytes);
    expect(esmResult.metadata.title).toBe('Smoke Test');

    const cjsBytes = cjs.writeEpubContent(document);
    const cjsResult = cjs.readEpubContent(cjsBytes);
    expect(cjsResult.metadata.title).toBe('Smoke Test');
    expect(cjsResult.sections[0]?.blocks).toEqual(esmResult.sections[0]?.blocks);
  });
});
