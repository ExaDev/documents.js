import { useEffect } from "react";
import type { ReactNode } from "react";

import {
  OpenDocumentProvider,
  useOpenDocument,
} from "../document/OpenDocumentContext";
import type { OpenedFile } from "../ports/fileAccess";
import { mountWithProviders } from "./mountComponent";

// Captured the same way convert.test.tsx/metadata.test.tsx's own mocked FileUpload used to capture onFile: a tiny in-tree component reads openDocument out of context and stashes it in module scope, so a test can drive it from outside React entirely — the panel under test never renders its own FileUpload any more, so there's no props object left to capture this from directly. The stash happens in an effect, not directly during render, per react-hooks/set-state-in-effect's -- or here, react-hooks/globals' -- own guidance: a component/hook body must stay pure, and mutating an outer-scope variable is a side effect that belongs in an effect.
let latestOpenDocument: ((file: OpenedFile) => void) | undefined;

// Exported (not just defined) so the fast-refresh boundary rule recognises this file as having a real component export to anchor on, alongside the plain helper functions below -- an unexported component still trips the rule even when every other export is separately allowlisted.
export function OpenDocumentCapture() {
  const { openDocument } = useOpenDocument();
  useEffect(() => {
    latestOpenDocument = openDocument;
  });
  return null;
}

// Call from afterEach — mirrors resetting latestOnFile between tests in the pre-refactor route test suites.
export function resetOpenDocumentCapture() {
  latestOpenDocument = undefined;
}

export function openDocument(file: OpenedFile) {
  if (latestOpenDocument === undefined) {
    throw new Error(
      "openDocument() called before mountWithOpenDocument() captured a provider",
    );
  }
  latestOpenDocument(file);
}

// Wraps a panel under test in a real OpenDocumentProvider (not a mock) so its useEffect-driven behaviour runs exactly as it does in the app, with openDocument() above the only way a test opens a file.
export function mountWithOpenDocument(node: ReactNode) {
  return mountWithProviders(
    <OpenDocumentProvider>
      <OpenDocumentCapture />
      {node}
    </OpenDocumentProvider>,
  );
}
