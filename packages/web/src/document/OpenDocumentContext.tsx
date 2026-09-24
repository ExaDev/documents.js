import type { DocumentFormat } from "documents.js";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import type { OpenedFile } from "../ports/fileAccess";
import { inferFormatFromFilename } from "../shared/extensionToFormat";

// The one document the whole app reads and writes: whatever was most recently opened, plus its format as inferred from the filename (undefined when the extension isn't recognised — a tool decides for itself whether that matters, since Convert/Inspect offer a manual override while Metadata/Fonts/Package simply can't proceed without one, Editors needs one of its four editable formats, and Odb/Odm work from raw bytes regardless). `id` is a monotonic open sequence number, not a file property — a panel that needs to reset its own local state on every fresh open (including a re-pick of the identical file) uses it as a React `key`, so the reset happens by remounting rather than by calling a setState setter directly inside an effect.
export interface OpenDocument {
  id: number;
  file: OpenedFile;
  format: DocumentFormat | undefined;
}

export interface OpenDocumentContextValue {
  document: OpenDocument | undefined;
  openDocument: (file: OpenedFile) => void;
}

const OpenDocumentContext = createContext<OpenDocumentContextValue | undefined>(
  undefined,
);

// Mounted once, by the root route, so the open document outlives every navigation in the app rather than only those that stay within one layout subtree. Recent Files opens into it directly from outside the document tools, which is why there is no cross-route hand-off mechanism here: every caller is inside this one provider.
export function OpenDocumentProvider({ children }: { children: ReactNode }) {
  const [document, setDocument] = useState<OpenDocument | undefined>(undefined);
  const nextId = useRef(1);

  const openDocument = useCallback((file: OpenedFile) => {
    setDocument({
      id: nextId.current++,
      file,
      format: inferFormatFromFilename(file.name),
    });
  }, []);

  const value = useMemo<OpenDocumentContextValue>(
    () => ({ document, openDocument }),
    [document, openDocument],
  );

  return (
    <OpenDocumentContext.Provider value={value}>
      {children}
    </OpenDocumentContext.Provider>
  );
}

// Every caller is a descendant of the root route, the sole place OpenDocumentProvider mounts — a call site outside that tree is a real structural bug, not a case worth papering over with a silent default.
export function useOpenDocument(): OpenDocumentContextValue {
  const context = useContext(OpenDocumentContext);
  if (context === undefined) {
    throw new Error(
      "useOpenDocument must be used within an OpenDocumentProvider",
    );
  }
  return context;
}
