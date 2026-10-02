import type { AppFiles } from '../application/settings-use-cases';

/**
 * The device file operations the app-files store needs. Declared here so its
 * rules can be tested with fakes; the Expo implementation is in
 * expo-app-file-system.ts.
 */
export type AppFileSystem = {
  /** The app's cache folder, as a URI ending in "/". */
  cacheDirectory(): string;
  /** The app's private documents folder, as a URI ending in "/". */
  documentDirectory(): string;
  /** URIs of the files directly inside a folder; empty when it does not exist. */
  listFiles(directoryUri: string): Promise<string[]>;
  /** Size of a file in bytes; 0 when it does not exist. */
  size(uri: string): Promise<number>;
  exists(uri: string): Promise<boolean>;
  move(fromUri: string, toUri: string): Promise<void>;
  /** Deletes a file. Does nothing when it does not exist. */
  delete(uri: string): Promise<void>;
};

/** Images of saved results, inside the documents folder. */
const SCANS = 'scans/';
/** Images set aside while their result is being deleted, inside the documents folder. */
const STAGING = 'scans-deleting/';
/**
 * Folders inside the cache that hold only the app's own temporary files:
 * review previews, the camera's captures, resized copies made for reading,
 * and the copies the file picker makes of a chosen roster.
 */
const CACHE_FOLDERS = ['scan-previews/', 'Camera/', 'ImageManipulator/', 'DocumentPicker/'];
/** Generated answer-sheet files, written directly into the cache for sharing. */
const SHEET_PREFIX = 'Answer sheet - ';
const SHEET_SUFFIX = '.pdf';
/** A scan image is exactly one PNG file directly inside its folder. */
const IMAGE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.png$/;

type Removable = { uri: string; restoreTo?: string };

/**
 * Measures and removes the app's own files. It works only from a fixed list
 * of folders under the app's cache and documents folders, and removes only
 * what a listing of one of those folders returned, so no path from anywhere
 * else can reach a delete: not the Teacher's original roster file, not the
 * database, not a file of another app.
 */
export function createAppFiles(fileSystem: AppFileSystem): AppFiles {
  const cache = () => fileSystem.cacheDirectory();
  const documents = () => fileSystem.documentDirectory();
  const nameIn = (folderUri: string, uri: string) =>
    uri.startsWith(folderUri) ? uri.slice(folderUri.length) : null;

  /** Files directly inside a folder, by that folder's own listing, with a plain name. */
  async function filesOf(folderUri: string): Promise<{ uri: string; name: string }[]> {
    const found: { uri: string; name: string }[] = [];
    for (const uri of await fileSystem.listFiles(folderUri)) {
      const name = nameIn(folderUri, uri);
      if (name !== null && name.length > 0 && !name.includes('/') && !name.includes('..')) {
        found.push({ uri, name });
      }
    }
    return found;
  }

  /** Everything in the cache that is the app's own temporary work. */
  async function cacheLeftovers(): Promise<string[]> {
    const uris: string[] = [];
    for (const folder of CACHE_FOLDERS) {
      for (const file of await filesOf(`${cache()}${folder}`)) uris.push(file.uri);
    }
    for (const file of await filesOf(cache())) {
      if (file.name.startsWith(SHEET_PREFIX) && file.name.endsWith(SHEET_SUFFIX)) uris.push(file.uri);
    }
    return uris;
  }

  /**
   * What a cleanup may remove. A staged image whose result still exists (its
   * deletion was interrupted before the rows were deleted) is not removed: it
   * is marked to be moved back.
   */
  async function temporary(referencedImagePaths: readonly string[]): Promise<Removable[]> {
    const referenced = new Set(referencedImagePaths);
    const found: Removable[] = (await cacheLeftovers()).map((uri) => ({ uri }));

    for (const file of await filesOf(`${documents()}${STAGING}`)) {
      if (!IMAGE_NAME.test(file.name)) continue;
      const finalUri = `${documents()}${SCANS}${file.name}`;
      const stillHasResult = referenced.has(`${SCANS}${file.name}`);
      if (stillHasResult && !(await fileSystem.exists(finalUri))) {
        found.push({ uri: file.uri, restoreTo: finalUri });
      } else {
        found.push({ uri: file.uri });
      }
    }
    // An image no result refers to: a save that failed half-way.
    for (const file of await filesOf(`${documents()}${SCANS}`)) {
      if (IMAGE_NAME.test(file.name) && !referenced.has(`${SCANS}${file.name}`)) {
        found.push({ uri: file.uri });
      }
    }
    return found;
  }

  async function sizeOf(uris: readonly string[]): Promise<number> {
    let total = 0;
    for (const uri of uris) total += await fileSystem.size(uri).catch(() => 0);
    return total;
  }

  return {
    async measureScanImages() {
      const images = (await filesOf(`${documents()}${SCANS}`)).filter((file) => IMAGE_NAME.test(file.name));
      return sizeOf(images.map((file) => file.uri));
    },

    async measureTemporary(referencedImagePaths) {
      const removable = (await temporary(referencedImagePaths)).filter((file) => !file.restoreTo);
      return sizeOf(removable.map((file) => file.uri));
    },

    async cleanTemporary(referencedImagePaths) {
      let freed = 0;
      let failures = 0;
      for (const file of await temporary(referencedImagePaths)) {
        try {
          if (file.restoreTo) {
            await fileSystem.move(file.uri, file.restoreTo);
          } else {
            const size = await fileSystem.size(file.uri).catch(() => 0);
            await fileSystem.delete(file.uri);
            freed += size;
          }
        } catch {
          failures++;
        }
      }
      // Something stayed behind: say so rather than report a clean result.
      if (failures > 0 && freed === 0) throw new Error('Temporary files could not be removed.');
      return freed;
    },

    async deleteEverything() {
      const uris = [
        ...(await filesOf(`${documents()}${SCANS}`)).map((file) => file.uri),
        ...(await filesOf(`${documents()}${STAGING}`)).map((file) => file.uri),
        ...(await cacheLeftovers()),
      ];
      let failures = 0;
      for (const uri of uris) {
        try {
          await fileSystem.delete(uri);
        } catch {
          failures++;
        }
      }
      if (failures > 0) throw new Error('Some files could not be removed.');
    },
  };
}
