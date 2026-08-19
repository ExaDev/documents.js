import { Group, Text, useMantineTheme } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import type { FileWithPath } from '@mantine/dropzone';
import { IconCheck, IconFile, IconUpload, IconX } from '@tabler/icons-react';
import { useMemo } from 'react';

import { createFileAccess } from '../adapters/fileAccess/createFileAccess';
import { recordRecentFile } from '../hooks/useRecentFiles';
import type { OpenedFile } from '../ports/fileAccess';
import { inferFormatFromFilename } from '../shared/extensionToFormat';
import { dropzoneContent } from './FileUpload.css';

export interface FileUploadProps {
  /** Passed straight through to FileAccessPort.openFile's `accept` -- normalised below into Dropzone's own (looser) Accept shape, so both consumers stay driven by a single value with no risk of drift. */
  accept?: FilePickerAcceptType['accept'];
  /** Short hint under the dropzone, e.g. "docx, odt, pdf, or markdown". Purely textual -- accept is what's enforced. */
  formatHint?: string;
  file?: OpenedFile;
  onFile: (file: OpenedFile) => void;
  disabled?: boolean;
  loading?: boolean;
}

// On a Chromium drop, file-selector (the library @mantine/dropzone is built on) already calls DataTransferItem.getAsFileSystemHandle() internally and attaches the result as FileWithPath.handle -- confirmed by reading its real, published type declaration (file-selector's file.d.ts declares `readonly handle?: FileSystemFileHandle` directly on FileWithPath). Drag-and-drop gets a real, persistable handle with zero extra wiring here.
async function toOpenedFile(file: FileWithPath): Promise<OpenedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, name: file.name, handle: file.handle };
}

// Recorded here rather than per-route so every tool's opens land in Recent Files for free -- skipped when the filename's extension isn't recognised, since a format-less record wouldn't be reopenable as anything in particular.
function recordIfRecognised(opened: OpenedFile) {
  const format = inferFormatFromFilename(opened.name);
  if (format === undefined) return;
  void recordRecentFile({ format, name: opened.name, sizeBytes: opened.bytes.byteLength, handle: opened.handle });
}

export function FileUpload({ accept, formatHint, file, onFile, disabled, loading }: FileUploadProps) {
  const theme = useMantineTheme();
  const fileAccess = useMemo(() => createFileAccess(), []);
  const dropzoneAccept = useMemo(() => {
    if (accept === undefined) return undefined;
    const normalised: Record<string, string[]> = {};
    for (const [mimeType, extensions] of Object.entries(accept)) {
      normalised[mimeType] = Array.isArray(extensions) ? [...extensions] : [extensions];
    }
    return normalised;
  }, [accept]);

  const handleDrop = (files: FileWithPath[]) => {
    const [dropped] = files;
    if (dropped === undefined) return;
    void toOpenedFile(dropped).then((opened) => {
      recordIfRecognised(opened);
      onFile(opened);
    });
  };

  // Chromium's native picker (used elsewhere in the app -- e.g. Convert's "reuse this upload for a different target" flow relies on it returning a FileSystemFileHandle) is driven directly rather than Dropzone's own <input type=file> click path, so there is exactly one code path that ever calls showOpenFilePicker. activateOnClick=false leaves drag-and-drop untouched.
  const handleClick = () => {
    if (!fileAccess.supportsNativePicker()) return;
    void fileAccess.openFile({ accept }).then((opened) => {
      if (opened === undefined) return;
      recordIfRecognised(opened);
      onFile(opened);
    });
  };

  return (
    <Dropzone
      onDrop={handleDrop}
      onClick={fileAccess.supportsNativePicker() ? handleClick : undefined}
      activateOnClick={!fileAccess.supportsNativePicker()}
      accept={dropzoneAccept}
      multiple={false}
      loading={loading}
      disabled={disabled}
    >
      <Group justify="center" gap="md" mih={120} className={dropzoneContent}>
        <Dropzone.Accept>
          <IconCheck size={36} color={theme.colors.teal[6]} />
        </Dropzone.Accept>
        <Dropzone.Reject>
          <IconX size={36} color={theme.colors.red[6]} />
        </Dropzone.Reject>
        <Dropzone.Idle>{file !== undefined ? <IconFile size={36} /> : <IconUpload size={36} />}</Dropzone.Idle>

        <div>
          <Text size="sm" fw={500}>
            {file !== undefined ? file.name : 'Drag a file here or click to browse'}
          </Text>
          {file === undefined && formatHint !== undefined && (
            <Text size="xs" c="dimmed">
              {formatHint}
            </Text>
          )}
        </div>
      </Group>
    </Dropzone>
  );
}
