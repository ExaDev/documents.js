// Smoke test: the built dist/ artifact loads and works under both ESM and CJS, and every module the exports map's `./*` wildcard advertises genuinely exists in dist. Run only via `pnpm test:smoke` (turbo's _build builds dist first) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. The deep-import half is the guard: tsdown.config.ts builds one dist file per src module (root: 'src', the layout every sibling codec ships), and this suite fails loudly the moment that stops being true -- publint and attw both pass a wildcard whose targets are missing, so dist actually serving the advertised subpaths is provable only by loading them.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as esm from "../dist/index.js";

const require = createRequire(import.meta.url);
const cjs = require("../dist/index.cjs");

const BARREL_FUNCTIONS = [
  "readPpt",
  "readPptContent",
  "readPptStreams",
  "readRecordHeader",
  "readRecordAt",
  "readCurrentUserAtom",
  "buildPersistDirectory",
  "readDrawingShapes",
  "readStyleTextPropAtom",
  "readTextBody",
  "buildParagraphs",
  "masterUnitsToPoints",
  "layoutMetadataToSummaryInformation",
];
const BARREL_CONSTANTS = [
  "RECORD_HEADER_SIZE",
  "RT_Document",
  "MASTER_UNITS_PER_POINT",
  "CURRENT_USER_STREAM",
  "POWERPOINT_DOCUMENT_STREAM",
  "SUMMARY_INFORMATION_STREAM",
];
const BARREL_CLASSES = ["PptFormatError", "PptEncryptedError"];

describe("dist/ barrel exports are present in both builds", () => {
  for (const name of BARREL_FUNCTIONS) {
    it(`${name} is a function`, () => {
      expect(typeof esm[name]).toBe("function");
      expect(typeof cjs[name]).toBe("function");
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
      expect(typeof esm[name]).toBe("function");
      expect(typeof cjs[name]).toBe("function");
    });
  }
});

// The module table in this package's README names each of these as a module, and package.json's `./*` wildcard maps them onto ./dist/*.js -- so each must exist in dist in both module systems and export its own surface.
describe("dist/ deep imports resolve for every advertised module, in both builds", () => {
  const DEEP_MODULES = [
    { path: "../dist/read.js", exports: ["readPpt", "readPptContent"] },
    {
      path: "../dist/metadata.js",
      exports: ["layoutMetadataToSummaryInformation"],
    },
    { path: "../dist/content.js", exports: ["buildParagraphs"] },
    { path: "../dist/units.js", exports: ["masterUnitsToPoints"] },
    { path: "../dist/errors.js", exports: ["PptFormatError"] },
    { path: "../dist/record/header.js", exports: ["readRecordHeader"] },
    { path: "../dist/record/tree.js", exports: ["readRecordAt"] },
    { path: "../dist/record/types.js", exports: ["RT_Document"] },
    { path: "../dist/stream/current-user.js", exports: ["readCurrentUserAtom"] },
    { path: "../dist/stream/persist.js", exports: ["buildPersistDirectory"] },
    { path: "../dist/document/document-atom.js", exports: ["readDocumentAtom"] },
    { path: "../dist/document/fonts.js", exports: ["readFontNames"] },
    {
      path: "../dist/document/slide-list.js",
      exports: ["readSlideListWithText"],
    },
    { path: "../dist/drawing/shapes.js", exports: ["readDrawingShapes"] },
    { path: "../dist/text/atoms.js", exports: ["readTextBody"] },
    { path: "../dist/text/style.js", exports: ["readStyleTextPropAtom"] },
  ];

  for (const module of DEEP_MODULES) {
    it(`${module.path.replace("../dist/", "").replace(".js", "")} loads in both builds`, async () => {
      const esmModule = await import(module.path);
      const cjsModule = require(module.path.replace(".js", ".cjs"));
      for (const name of module.exports) {
        expect(esmModule[name]).toBeDefined();
        expect(cjsModule[name]).toBeDefined();
      }
    });
  }
});

// The test-support fixture builders must NOT ship: tsdown.config.ts excludes them, and a build config change that started emitting them would leak test-only code into the published package.
describe("dist/ excludes test-only modules", () => {
  for (const path of [
    "../dist/test-support/records.js",
    "../dist/test-support/compound-file.js",
    "../dist/test-support/presentation.js",
  ]) {
    it(`${path.replace("../dist/", "")} is absent`, async () => {
      await expect(import(path)).rejects.toThrow();
    });
  }
});
