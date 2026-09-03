import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  isomorphic: true,
  additionalRestrictedImportPatterns: [
    {
      group: ["xlsx", "xlsx/**", "node-xlsx", "exceljs", "cfb", "cfb/**"],
      message:
        "Hand-write the BIFF8 record parsing against [MS-XLS] instead of depending on a spreadsheet library -- see README Architecture. The compound-file layer comes from archive-codec.",
    },
  ],
});
