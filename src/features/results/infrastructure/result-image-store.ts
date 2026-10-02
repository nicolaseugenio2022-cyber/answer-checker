import type { ResultImageStore } from '../application/results-ports';

/**
 * The device file operations the result image store needs. Declared here so
 * the store's rules can be tested with fakes; the Expo implementation is in
 * expo-result-file-system.ts.
 */
export type ResultFileSystem = {
  /** The app's private documents folder, as a URI ending in "/". */
  documentDirectory(): string;
  exists(uri: string): Promise<boolean>;
  /** Moves a file within the app's documents folder. */
  move(fromUri: string, toUri: string): Promise<void>;
  /** Deletes a file. Does nothing when it does not exist. */
  delete(uri: string): Promise<void>;
  ensureDirectory(uri: string): Promise<void>;
  /** URIs of the files directly inside a folder; empty when it does not exist. */
  listFiles(directoryUri: string): Promise<string[]>;
};

/** Where Scan keeps the image of a saved result, inside the documents folder. */
const SCANS_FOLDER = 'scans/';
/** Where an image waits while its result is being deleted. Private, like the scans folder. */
const STAGING_FOLDER = 'scans-deleting/';

/**
 * A stored path is a scan image only when it is exactly one file directly
 * inside the scans folder: "scans/<name>.png", the name made of letters,
 * digits, dots, dashes, and underscores. Anything else (another folder, a
 * path with "..", an absolute path, a URI) is not, and is never touched.
 */
const SCAN_IMAGE_PATH = /^scans\/([A-Za-z0-9_-][A-Za-z0-9._-]*\.png)$/;

export function scanImageFileName(imagePath: string): string | null {
  if (imagePath.includes('..')) return null;
  return SCAN_IMAGE_PATH.exec(imagePath)?.[1] ?? null;
}

/**
 * Shows and permanently removes the private scan images of saved results.
 *
 * Every operation starts from a path stored in the database and refuses one
 * that is not a scan image, so nothing outside the app's scans folder and its
 * deletion-staging folder can be moved or deleted from here: not the Teacher's
 * files, not the cache, not a printable answer sheet.
 */
export function createResultImageStore(fileSystem: ResultFileSystem): ResultImageStore {
  const documents = () => fileSystem.documentDirectory();
  const finalUri = (fileName: string) => `${documents()}${SCANS_FOLDER}${fileName}`;
  const stagingFolder = () => `${documents()}${STAGING_FOLDER}`;
  const stagedUri = (fileName: string) => `${stagingFolder()}${fileName}`;

  return {
    async displayUri(imagePath) {
      const fileName = scanImageFileName(imagePath);
      if (fileName === null) return null;
      const uri = finalUri(fileName);
      return (await fileSystem.exists(uri)) ? uri : null;
    },

    async stage(imagePath) {
      const fileName = scanImageFileName(imagePath);
      if (fileName === null) return null;
      if (!(await fileSystem.exists(finalUri(fileName)))) return null;
      await fileSystem.ensureDirectory(stagingFolder());
      await fileSystem.move(finalUri(fileName), stagedUri(fileName));
      return { imagePath };
    },

    async restore(staged) {
      const fileName = scanImageFileName(staged.imagePath);
      if (fileName === null) return;
      await fileSystem.move(stagedUri(fileName), finalUri(fileName));
    },

    async discard(staged) {
      const fileName = scanImageFileName(staged.imagePath);
      if (fileName === null) return;
      await fileSystem.delete(stagedUri(fileName));
    },

    async settleStaged(referencedImagePaths) {
      const referenced = new Set(referencedImagePaths);
      for (const uri of await fileSystem.listFiles(stagingFolder())) {
        // Only what is directly inside the staging folder, by its own listing.
        if (!uri.startsWith(stagingFolder())) continue;
        const fileName = uri.slice(stagingFolder().length);
        const imagePath = `${SCANS_FOLDER}${fileName}`;
        if (scanImageFileName(imagePath) === null) continue;
        try {
          if (referenced.has(imagePath) && !(await fileSystem.exists(finalUri(fileName)))) {
            // The deletion never reached the database: the result still exists and gets its image back.
            await fileSystem.move(uri, finalUri(fileName));
          } else {
            await fileSystem.delete(uri);
          }
        } catch {
          // Left for the next time.
        }
      }
    },
  };
}
