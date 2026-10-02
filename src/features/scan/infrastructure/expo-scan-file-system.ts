import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { ScanFileSystem } from './scan-image-store';

const withSlash = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);

/** Device implementation of the scan file operations. Uses no network and no shared storage. */
export const expoScanFileSystem: ScanFileSystem = {
  cacheDirectory: () => withSlash(Paths.cache.uri),
  documentDirectory: () => withSlash(Paths.document.uri),

  async resizeToPng(sourceUri, width) {
    const context = ImageManipulator.manipulate(sourceUri);
    context.resize({ width });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.PNG });
    return saved.uri;
  },

  readBytes: (uri) => new File(uri).bytes(),

  async writeBytes(uri, bytes) {
    const file = new File(uri);
    if (!file.exists) file.create();
    file.write(bytes);
  },

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
