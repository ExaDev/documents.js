import type { FileAccessPort, OpenedFile, SaveResult } from '../../ports/fileAccess';

// Chromium only (showOpenFilePicker/showSaveFilePicker). Returns a persistable FileSystemFileHandle so callers can offer "recent files" reopen -- see fallbackFileAccess.ts for the browser that don't support this.
export function createNativeFileAccess(): FileAccessPort {
  return {
    supportsNativePicker: () => true,

    async openFile(options): Promise<OpenedFile | undefined> {
      const types = options.accept
        ? [{ description: 'Document', accept: options.accept }]
        : undefined;
      let handles: FileSystemFileHandle[];
      try {
        handles = await window.showOpenFilePicker({ types, multiple: false });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return undefined;
        throw error;
      }
      const [handle] = handles;
      if (handle === undefined) return undefined;
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { bytes, name: file.name, handle };
    },

    async saveFile(bytes, options): Promise<SaveResult> {
      let handle: FileSystemFileHandle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: options.suggestedName,
          types: [{ description: 'Document', accept: { [options.mimeType]: [`.${options.suggestedName.split('.').pop() ?? 'bin'}`] } }],
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return {};
        throw error;
      }
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return { handle };
    },
  };
}
