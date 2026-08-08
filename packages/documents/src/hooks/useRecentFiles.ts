import { useLiveQuery } from 'dexie-react-hooks';
import type { DocumentFormat } from 'documents.js';

import { db } from '../db/dexie';

const RECENT_FILES_LIMIT = 20;

// useLiveQuery re-runs (and every consumer re-renders) the instant any write lands in db.recentFiles -- no manual invalidation needed after recordRecentFile/removeRecentFile.
export function useRecentFiles() {
  return useLiveQuery(() => db.recentFiles.orderBy('lastOpenedAt').reverse().limit(RECENT_FILES_LIMIT).toArray(), []);
}

export interface RecentFileEntry {
  format: DocumentFormat;
  name: string;
  sizeBytes: number;
  handle?: FileSystemFileHandle;
}

// Called uniformly from FileUpload's onFile, so every tool's opens are recorded without each route wiring it up itself. FIFO eviction at write time keeps the table capped at RECENT_FILES_LIMIT rather than growing unbounded.
export async function recordRecentFile(entry: RecentFileEntry) {
  await db.recentFiles.add({ ...entry, lastOpenedAt: Date.now() });
  const staleCount = (await db.recentFiles.count()) - RECENT_FILES_LIMIT;
  if (staleCount <= 0) return;
  const stale = await db.recentFiles.orderBy('lastOpenedAt').limit(staleCount).toArray();
  await db.recentFiles.bulkDelete(stale.map((record) => record.id).filter((id) => id !== undefined));
}

export async function removeRecentFile(id: number) {
  await db.recentFiles.delete(id);
}
