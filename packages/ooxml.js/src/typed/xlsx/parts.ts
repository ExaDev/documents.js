import type { Package } from "../../model/package";
import { findMainPartPath, findRelatedPartPath } from "../opc";

// Where a workbook's parts actually live. OPC names the workbook part through the package root's own officeDocument relationship and each of its companion parts through the workbook's own relationships, so nothing here reads a conventional path unless the package declares no usable relationship for it -- see typed/opc.ts for why a conventional name is never authoritative.

const CONVENTIONAL_WORKBOOK_PATH = "xl/workbook.xml";
const CONVENTIONAL_STYLES_PATH = "xl/styles.xml";
const CONVENTIONAL_SHARED_STRINGS_PATH = "xl/sharedStrings.xml";
const STYLES_REL_SUFFIX = "/styles";
const SHARED_STRINGS_REL_SUFFIX = "/sharedStrings";

export function workbookPartPath(pkg: Package): string {
  return findMainPartPath(pkg) ?? CONVENTIONAL_WORKBOOK_PATH;
}

export function stylesPartPath(pkg: Package): string {
  return (
    findRelatedPartPath(pkg, workbookPartPath(pkg), STYLES_REL_SUFFIX) ??
    CONVENTIONAL_STYLES_PATH
  );
}

export function sharedStringsPartPath(pkg: Package): string {
  return (
    findRelatedPartPath(
      pkg,
      workbookPartPath(pkg),
      SHARED_STRINGS_REL_SUFFIX,
    ) ?? CONVENTIONAL_SHARED_STRINGS_PATH
  );
}
