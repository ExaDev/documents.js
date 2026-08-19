import Dexie, { type EntityTable } from 'dexie';

export interface RecentFileRecord {
  id?: number;
  format: string;
  name: string;
  sizeBytes: number;
  lastOpenedAt: number;
  handle?: FileSystemFileHandle;
}

export interface PreferenceRecord {
  key: string;
  value: unknown;
}

export interface CustomFontRecord {
  id?: number;
  family: string;
  bold: boolean;
  italic: boolean;
  bytes: Blob;
}

export interface EditorSessionRecord {
  id?: number;
  sessionId: string;
  format: string;
  originalName: string;
  lastSnapshotAt: number;
  sizeBytes: number;
  cleanlyClosed: boolean;
}

// Schema declared in full up front (per the approved architecture plan) even though only recentFiles/preferences are read/written by the current convert-tool slice -- the editor/autosave and custom-font features land against this same version-1 schema rather than forcing a Dexie version bump later. Subclassing (Dexie's own documented TypeScript pattern) avoids casting the Dexie instance to a table-shaped type.
class DocumentsDatabase extends Dexie {
  recentFiles!: EntityTable<RecentFileRecord, 'id'>;
  preferences!: EntityTable<PreferenceRecord, 'key'>;
  customFonts!: EntityTable<CustomFontRecord, 'id'>;
  editorSessions!: EntityTable<EditorSessionRecord, 'id'>;

  constructor() {
    super('exadev-documents');
    this.version(1).stores({
      recentFiles: '++id, format, lastOpenedAt',
      preferences: 'key',
      customFonts: '++id, family',
      editorSessions: '++id, sessionId, format, lastSnapshotAt, cleanlyClosed',
    });
  }
}

export const db = new DocumentsDatabase();
