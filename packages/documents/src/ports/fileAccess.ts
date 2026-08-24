export interface OpenedFile {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  handle?: FileSystemFileHandle;
}

export interface SaveResult {
  handle?: FileSystemFileHandle;
}

export interface FileAccessPort {
  supportsNativePicker(): boolean;
  openFile(options: {
    accept?: FilePickerAcceptType["accept"];
  }): Promise<OpenedFile | undefined>;
  saveFile(
    bytes: Uint8Array<ArrayBuffer>,
    options: { suggestedName: string; mimeType: MIMEType },
  ): Promise<SaveResult>;
}
