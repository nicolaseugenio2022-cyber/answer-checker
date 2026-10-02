import type { ScanImageStore } from '../application/scan-ports';
import { decodePngToGray, encodeGrayToPng } from './omr/png';

/**
 * The device file operations the scan image store needs. Declared here so the
 * store's rules can be tested with fakes; the Expo implementation is in
 * expo-scan-file-system.ts.
 */
export type ScanFileSystem = {
  /** The app's cache folder, as a URI ending in "/". Files in it may be deleted by the system. */
  cacheDirectory(): string;
  /** The app's private documents folder, as a URI ending in "/". */
  documentDirectory(): string;
  /** Writes a copy of a picture as an 8-bit PNG no wider than `width`, in the cache, and returns its URI. */
  resizeToPng(sourceUri: string, width: number): Promise<string>;
  readBytes(uri: string): Promise<Uint8Array>;
  writeBytes(uri: string, bytes: Uint8Array): Promise<void>;
  move(fromUri: string, toUri: string): Promise<void>;
  /** Deletes a file. Does nothing when it does not exist. */
  delete(uri: string): Promise<void>;
  ensureDirectory(uri: string): Promise<void>;
  /** URIs of the files directly inside a folder; empty when it does not exist. */
  listFiles(directoryUri: string): Promise<string[]>;
};

/** The photo is reduced to this width before it is read: enough for the bubbles, fast to process. */
export const WORKING_WIDTH = 1280;

/** Folder of previews inside the cache, and of final images inside the documents folder. */
const PREVIEW_FOLDER = 'scan-previews/';
const FINAL_FOLDER = 'scans/';
/** Where expo-camera writes captures, and expo-image-manipulator its results. */
const CAPTURE_FOLDERS = ['Camera/', 'ImageManipulator/'];

type Options = {
  fileSystem: ScanFileSystem;
  /** A fresh, unguessable name for each preview file. */
  newName: () => string;
};

/**
 * Keeps scan pictures in the app's own folders and nowhere else.
 *
 * Deleting is always guarded by location: a file is deleted only when its URI
 * lies inside the app's cache or inside the app's scans folder. A URI anywhere
 * else is left untouched, whatever asked for its deletion.
 */
export function createScanImageStore({ fileSystem, newName }: Options): ScanImageStore {
  const cache = () => fileSystem.cacheDirectory();
  const previews = () => `${cache()}${PREVIEW_FOLDER}`;
  const finals = () => `${fileSystem.documentDirectory()}${FINAL_FOLDER}`;
  const isInCache = (uri: string) => uri.startsWith(cache());
  const isFinal = (uri: string) => uri.startsWith(finals());

  async function deleteIfOwned(uri: string): Promise<void> {
    if (isInCache(uri) || isFinal(uri)) await fileSystem.delete(uri);
  }

  return {
    async loadCapture(captureUri) {
      const pngUri = await fileSystem.resizeToPng(captureUri, WORKING_WIDTH);
      try {
        return decodePngToGray(await fileSystem.readBytes(pngUri));
      } finally {
        // The resized copy is only a step on the way; it never outlives the read.
        if (pngUri !== captureUri) await deleteIfOwned(pngUri).catch(() => undefined);
      }
    },

    discardCapture(captureUri) {
      return deleteIfOwned(captureUri);
    },

    async writePreview(image) {
      await fileSystem.ensureDirectory(previews());
      const uri = `${previews()}${newName()}.png`;
      await fileSystem.writeBytes(uri, encodeGrayToPng(image));
      return uri;
    },

    discardPreview(previewUri) {
      return deleteIfOwned(previewUri);
    },

    async keepPreview(previewUri, resultId) {
      if (!previewUri.startsWith(previews())) throw new Error('Not a scan preview.');
      await fileSystem.ensureDirectory(finals());
      const imagePath = `${FINAL_FOLDER}${resultId}.png`;
      await fileSystem.move(previewUri, `${fileSystem.documentDirectory()}${imagePath}`);
      return imagePath;
    },

    async deleteFinal(imagePath) {
      // Only a path inside the scans folder, with no way out of it.
      if (!imagePath.startsWith(FINAL_FOLDER) || imagePath.includes('..')) return;
      await fileSystem.delete(`${fileSystem.documentDirectory()}${imagePath}`);
    },

    uriOf(pathOrUri) {
      return pathOrUri.includes('://') ? pathOrUri : `${fileSystem.documentDirectory()}${pathOrUri}`;
    },

    async cleanUp(referencedImagePaths) {
      // Temporary files of an earlier session: every preview and every capture.
      const temporary = [previews(), ...CAPTURE_FOLDERS.map((folder) => `${cache()}${folder}`)];
      for (const folder of temporary) {
        for (const uri of await fileSystem.listFiles(folder)) {
          if (isInCache(uri)) await fileSystem.delete(uri).catch(() => undefined);
        }
      }
      // Final images whose result does not exist: a save that failed half-way.
      const referenced = new Set(
        referencedImagePaths.map((path) => `${fileSystem.documentDirectory()}${path}`)
      );
      for (const uri of await fileSystem.listFiles(finals())) {
        if (isFinal(uri) && !referenced.has(uri)) await fileSystem.delete(uri).catch(() => undefined);
      }
    },
  };
}
