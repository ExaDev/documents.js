import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  isomorphic: true,
  // Passed to the shared config rather than declared as a second rule block: flat config replaces a same-key rule instead of merging it, so a second no-restricted-imports here would silently switch the Worker-isomorphism Node-builtin ban back off while still reporting these.
  //
  // This package hand-parses [MS-DOC]'s binary structures against the published specification, the same bet markdown-codec makes against every markdown library and pdf-codec against pdf-lib. Depending on an existing .doc reader would defeat the reason it exists, so each one is banned by name -- every module of every library, not just its main entry point.
  additionalRestrictedImportPatterns: [
    {
      group: ["word-extractor", "word-extractor/**"],
      message:
        "Hand-parse [MS-DOC] instead of depending on word-extractor -- see README Architecture.",
    },
    {
      group: ["mammoth", "mammoth/**"],
      message:
        "Hand-parse [MS-DOC] instead of depending on mammoth -- see README Architecture.",
    },
    {
      group: ["cfb", "cfb/**"],
      message:
        "Read the compound-file container through archive-codec's own [MS-CFB] reader instead of depending on the cfb package -- see README Architecture.",
    },
    {
      group: ["textract", "textract/**"],
      message:
        "Hand-parse [MS-DOC] instead of depending on textract -- see README Architecture.",
    },
    {
      group: ["antiword*", "antiword*/**"],
      message:
        "Hand-parse [MS-DOC] instead of shelling out to antiword -- see README Architecture.",
    },
  ],
});
