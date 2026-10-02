import { Directory, File, Paths } from 'expo-file-system';

import type { AppFileSystem } from './app-files';

const withSlash = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);

/** Device implementation of the app-files operations. Uses no network and no shared storage. */
export const expoAppFileSystem: AppFileSystem = {
  cacheDirectory: () => withSlash(Paths.cache.uri),
  documentDirectory: () => withSlash(Paths.document.uri),

  async listFiles(directoryUri) {
    const directory = new Directory(directoryUri);
    if (!directory.exists) return [];
    return directory
      .list()
      .filter((entry) => entry instanceof File)
      .map((entry) => entry.uri);
  },

  async size(uri) {
    const file = new File(uri);
    return file.exists ? (file.size ?? 0) : 0;
  },

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
};
