import tseslint from "typescript-eslint";
import { packageLintConfig } from "../../eslint.shared.ts";

export default tseslint.config(
  ...packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    isomorphic: true,
    // This package hand-writes its own OCF/OPF/nav/XHTML mapping against fast-xml-parser and fflate directly, the same bet every sibling codec here makes against a heavyweight format library. Depending on an existing EPUB library would defeat the entire reason it exists as a hand-written, dependency-minimal codec -- see README Architecture for the archive-codec/byte-codec reuse decisions this package did make.
    additionalRestrictedImportPatterns: [
      {
        group: ["epubjs", "epubjs/**"],
        message:
          "Hand-write the OCF/OPF/XHTML mapping instead of depending on epub.js -- see README Architecture.",
      },
      {
        group: ["epub-gen", "epub-gen/**"],
        message:
          "Hand-write the EPUB writer instead of depending on epub-gen -- see README Architecture.",
      },
      {
        group: ["epub2", "epub2/**"],
        message:
          "Hand-write the EPUB reader instead of depending on the epub2 package -- see README Architecture.",
      },
      {
        group: ["node-epub", "node-epub/**"],
        message:
          "Hand-write the EPUB writer instead of depending on node-epub -- see README Architecture.",
      },
      {
        group: [
          "adm-zip",
          "adm-zip/**",
          "jszip",
          "jszip/**",
          "yazl",
          "yazl/**",
          "yauzl",
          "yauzl/**",
        ],
        message:
          "Use this package's own zip.ts (fflate, fixed-mtime, ordered entries) instead of a general-purpose ZIP library -- see README Architecture.",
      },
    ],
  }),
  {
    // fast-xml-parser@5 deprecates the whole XMLBuilder class, not one of its options, and ships no replacement of its own -- it points at a separate `fast-xml-builder` package that is not a declared dependency here. Swapping it is a real dependency decision with round-trip fidelity to re-verify (this builder is what keeps XML byte-faithful), so it is tracked rather than guessed at inside a tooling change -- the identical override ooxml.js's and odf.js's own eslint.config.ts each carry for their structurally-identical build.ts. Scoped to the one module that constructs the builder.
    files: ["src/xml/build.ts"],
    rules: { "@typescript-eslint/no-deprecated": "off" },
  },
);
