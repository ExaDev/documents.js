// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to this file by vitest.config.ts's "smoke" project) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

const FUNCTIONS = [
  'decodePackage',
  'encodePackage',
  'zipPackage',
  'unzipPackage',
  'parseXml',
  'buildXml',
  'bytesToBase64',
  'base64ToBytes',
  'xmlnsAttributes',
  'mediaTypeForExtension',
  'sniffImageFormat',
  'readMimetype',
  'writeMimetype',
  'el',
  'txt',
  'encodeXmlText',
  'readManifest',
  'buildManifest',
  'writeManifest',
  'syncManifest',
  'validateManifest',
  'setDocumentMediaType',
  // Both levels of every typed reader: the package-native primary and the flat *Content function beneath it. Listed here so a rename or a missing barrel export fails against the BUILT artifact, not only against src.
  'readOdt',
  'readOdtContent',
  'readOdp',
  'readOdpContent',
  'readOdg',
  'readOdgContent',
  'readOds',
  'readOdsContent',
  'readOdfFormula',
  'readOdfFormulaContent',
  'readOdfFormulaMathMl',
  // The odt writer, at the same two levels as its reader, plus the canonical form its round-trip law is stated against and the package scaffold it builds on.
  'writeOdt',
  'writeOdtContent',
  'normaliseOdtContent',
  'createOdfPackage',
  // The ods writer, at the same two levels as its reader, plus the canonical form its round-trip law is stated against.
  'writeOds',
  'writeOdsContent',
  'normaliseOdsContent',
  // The OpenOffice.org 1.x readers, at the same two levels, plus the package transform they are built on and the detection a caller needs to pick between these and the ODF readers above.
  'readSxw',
  'readSxwContent',
  'readSxc',
  'readSxcContent',
  'readSxi',
  'readSxiContent',
  'readSxd',
  'readSxdContent',
  'transformOoo1Package',
  'isOoo1Package',
  'ooo1MediaTypeForExtension',
  'odfMediaTypeForOoo1MediaType',
];
const OBJECTS = [
  'packageCodec',
  'xmlCodec',
  'ODF_NAMESPACES',
  'ODF_MEDIA_TYPES',
  'OOO1_NAMESPACES',
  'OOO1_MEDIA_TYPES',
];

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

const enc = (s) => new TextEncoder().encode(s);
const bytes = esm.zipPackage([
  ['mimetype', { bytes: enc('application/vnd.oasis.opendocument.text'), stored: true }],
  [
    'content.xml',
    {
      bytes: enc(
        '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Smoke &amp; test</text:p></office:text></office:body></office:document-content>',
      ),
    },
  ],
]);

describe.each([
  ['ESM', esm],
  ['CJS', cjs],
])('%s artifact behaviour', (_label, api) => {
  const pkg1 = api.decodePackage(bytes);

  it('round-trips decode -> encode -> decode idempotently', () => {
    expect(api.decodePackage(api.encodePackage(pkg1))).toEqual(pkg1);
  });

  it('preserves the mimetype part content', () => {
    const mimetype = pkg1.parts.mimetype;
    expect(mimetype?.kind).toBe('binary');
  });

  it('preserves entity-encoded XML text content', () => {
    const content = pkg1.parts['content.xml'];
    expect(content?.kind).toBe('xml');
    expect(JSON.stringify(content)).toContain('Smoke &amp; test');
  });

  it('reads the mimetype part written into the fixture zip', () => {
    expect(api.readMimetype(pkg1)).toBe('application/vnd.oasis.opendocument.text');
  });

  it('builds and validates a manifest that exhaustively covers the fixture package', () => {
    const withManifest = api.decodePackage(bytes);
    api.syncManifest(withManifest);
    expect(api.validateManifest(withManifest)).toEqual([]);
    const manifest = api.readManifest(withManifest);
    expect(manifest.entries.find((e) => e.fullPath === '/')?.mediaType).toBe('application/vnd.oasis.opendocument.text');
  });
});
