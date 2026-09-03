import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  isomorphic: true,
  // Passed to the shared config rather than declared here, because flat config replaces a same-key rule instead of merging it: a second no-restricted-imports over runtime src would silently drop the Worker-isomorphism Node-builtin ban while still reporting these.
  //
  // RTF is tokenised plain text, not XML, so none of this family's existing XML plumbing applies and none of the JavaScript RTF libraries below could be reached for without defeating the reason this package exists at all -- the same hand-write bet markdown-codec makes against micromark/remark and pdf-codec makes against pdf-lib/pdfjs-dist. Each is banned by name rather than by guessing at specifiers, covering every module of every library rather than only its main entry point.
  additionalRestrictedImportPatterns: [
    {
      group: ["rtf-parser", "rtf-parser/**"],
      message:
        "Hand-write the tokenizer/parser instead of depending on rtf-parser -- see README Architecture.",
    },
    {
      group: ["rtf.js", "rtf.js/**"],
      message:
        "Hand-write the reader instead of depending on rtf.js -- see README Architecture.",
    },
    {
      group: ["rtf-stream-parser", "rtf-stream-parser/**"],
      message:
        "Hand-write the destination state machine instead of depending on rtf-stream-parser -- see README Architecture.",
    },
    {
      group: ["node-rtf*", "node-rtf*/**"],
      message:
        "Hand-write the writer instead of depending on node-rtf -- see README Architecture.",
    },
    {
      group: ["jsrtf", "jsrtf/**"],
      message:
        "Hand-write the writer instead of depending on jsrtf -- see README Architecture.",
    },
    {
      group: ["@shelf/rtf-to-html", "@shelf/rtf-to-html/**"],
      message:
        "Hand-write the reader instead of depending on @shelf/rtf-to-html -- see README Architecture.",
    },
    {
      group: ["iconv-lite", "iconv-lite/**"],
      message:
        "Hand-write the codepage tables instead of depending on iconv-lite -- it is Node-only (Buffer) and would break Worker isomorphism; see src/codepage.ts.",
    },
  ],
});
