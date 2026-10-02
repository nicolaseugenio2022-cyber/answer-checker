import { Directory, File, Paths } from 'expo-file-system';

import type { ResultFileSystem } from './result-image-store';

const withSlash = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);

/** Device implementation of the result image file operations. Uses no network and no shared storage. */
export const expoResultFileSystem: ResultFileSystem = {
  documentDirectory: () => withSlash(Paths.document.uri),

  exists: async (uri) => new File(uri).exists,

  async move(fromUri, toUri) {
    const destination = new File(toUri);
    if (destination.exists) destination.delete();
    await new File(fromUri).move(destination);
  },

  async delete(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },

  async ensureDirectory(uri) {
    const directory = new Directory(uri);
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
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
