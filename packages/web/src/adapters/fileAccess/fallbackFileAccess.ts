import type {
  FileAccessPort,
  OpenedFile,
  SaveResult,
} from "../../ports/fileAccess";

// <input type="file"> open + Blob-URL <a download> save, for browsers without the File System Access API (Firefox, Safari). No FileSystemFileHandle is ever returned -- "recent files" for these callers is metadata-only history, not a reopenable reference.
export function createFallbackFileAccess(): FileAccessPort {
  return {
    supportsNativePicker: () => false,

    openFile(options): Promise<OpenedFile | undefined> {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        if (options.accept)
          input.accept = Object.values(options.accept).flat().join(",");
        input.addEventListener(
          "change",
          () => {
            void (async () => {
              const file = input.files?.[0];
              if (file === undefined) {
                resolve(undefined);
                return;
              }
              const bytes = new Uint8Array(await file.arrayBuffer());
              resolve({ bytes, name: file.name });
            })();
          },
          { once: true },
        );
        input.click();
      });
    },

    saveFile(bytes, options): Promise<SaveResult> {
      const blob = new Blob([bytes], { type: options.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = options.suggestedName;
      anchor.click();
      URL.revokeObjectURL(url);
      return Promise.resolve({});
    },
  };
}
