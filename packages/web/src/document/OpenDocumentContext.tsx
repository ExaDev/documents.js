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
import { takePendingReopen } from "../ui/reopenMailbox";

// The one document every tool nested under the '/_document' layout route reads and writes: whatever was most recently opened, plus its format as inferred from the filename (undefined when the extension isn't recognised — a tool decides for itself whether that matters, since Convert/Inspect offer a manual override while Metadata/Fonts/Package simply can't proceed without one, and Odb/Odm work from raw bytes regardless of format). `id` is a monotonic open sequence number, not a file property — a panel that needs to reset its own local state on every fresh open (including a re-pick of the identical file) uses it as a React `key`, so the reset happens by remounting rather than by calling a setState setter directly inside an effect.
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

export function OpenDocumentProvider({ children }: { children: ReactNode }) {
  // Seeded once from Recent Files' own "Reopen" hand-off (see reopenMailbox's module comment for the write-once/read-once contract) — a lazy initializer so it's read exactly once, on this provider's first mount, which is also this app's one and only OpenDocumentProvider instance. The reopened document counts as open #1, matching the sequence below.
  const [document, setDocument] = useState<OpenDocument | undefined>(() => {
    const reopened = takePendingReopen();
    return reopened === undefined ? undefined : { id: 1, ...reopened };
  });
  const nextId = useRef(2);

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

// Every caller is a descendant of the '/_document' layout route, the sole place OpenDocumentProvider mounts — a call site outside that subtree is a real structural bug, not a case worth papering over with a silent default.
export function useOpenDocument(): OpenDocumentContextValue {
  const context = useContext(OpenDocumentContext);
  if (context === undefined) {
    throw new Error(
      "useOpenDocument must be used within an OpenDocumentProvider",
    );
  }
  return context;
}
