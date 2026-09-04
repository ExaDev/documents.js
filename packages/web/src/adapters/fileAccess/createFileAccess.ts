import type { FileAccessPort } from "../../ports/fileAccess";
import { createFallbackFileAccess } from "./fallbackFileAccess";
import { createNativeFileAccess } from "./nativeFileAccess";

export function createFileAccess(): FileAccessPort {
  return "showOpenFilePicker" in window
    ? createNativeFileAccess()
    : createFallbackFileAccess();
}
