import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import type { RosterFileSystem } from './roster-file-picker';

/**
 * expo-document-picker copies a chosen file into this folder of the app's
 * cache when `copyToCacheDirectory` is on (Android: `cacheDir/DocumentPicker`).
 * The copy is what the app reads and deletes; the original is never opened for
 * writing.
 */
const importCache = () => new Directory(Paths.cache, 'DocumentPicker');

/** CSV has no single MIME type on Android; these are the ones file providers report. */
const CSV_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
];

/** Device implementation of the roster file operations. Uses no network. */
export const expoRosterFileSystem: RosterFileSystem = {
  importCacheDirectory: () => importCache().uri,

  async pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: CSV_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    return { uri: asset.uri, name: asset.name, size: asset.size ?? null };
  },

  readText: (uri) => new File(uri).text(),

  async deleteFile(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },

  async listFiles(directoryUri) {
    const directory = new Directory(directoryUri);
    if (!directory.exists) return [];
    return directory
      .list()
      .filter((entry) => entry instanceof File)
      .map((entry) => entry.uri);
  },
};
