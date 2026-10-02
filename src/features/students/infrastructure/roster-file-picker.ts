import type { PickedRosterFile, RosterFilePicker } from '../application/roster-import';

/**
 * The device file operations the roster picker needs. Declared here so the
 * lifecycle below can be tested with fakes; the Expo implementation is in
 * expo-roster-file-system.ts.
 */
export type RosterFileSystem = {
  /**
   * The folder into which the system picker copies a chosen file. Everything
   * in it belongs to the app; nothing outside it does.
   */
  importCacheDirectory(): string;
  /** Opens the system file picker. Null when the Teacher closes it. */
  pickDocument(): Promise<{ uri: string; name: string; size: number | null } | null>;
  readText(uri: string): Promise<string>;
  deleteFile(uri: string): Promise<void>;
  /** URIs of the files directly inside a folder; empty when it does not exist. */
  listFiles(directoryUri: string): Promise<string[]>;
};

const withTrailingSlash = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);

/**
 * Picks a roster file and controls the life of its temporary copy.
 *
 * The only thing ever deleted is a file inside the app's own import cache
 * folder. A URI anywhere else (the Teacher's original in Downloads, Drive, or
 * another provider) is read and then left alone: `release` does nothing to it.
 */
export function createRosterFilePicker(fileSystem: RosterFileSystem): RosterFilePicker {
  const isAppOwnedCopy = (uri: string) =>
    uri.startsWith(withTrailingSlash(fileSystem.importCacheDirectory()));

  return {
    async pick(): Promise<PickedRosterFile | null> {
      const picked = await fileSystem.pickDocument();
      if (!picked) return null;

      let released = false;
      return {
        name: picked.name,
        size: picked.size,
        read: () => fileSystem.readText(picked.uri),
        async release() {
          if (released) return;
          released = true;
          if (!isAppOwnedCopy(picked.uri)) return;
          try {
            await fileSystem.deleteFile(picked.uri);
          } catch (error) {
            // The copy stays in the cache folder; cleanUpStale removes it next time.
            console.warn('Could not delete the temporary roster copy.', error);
          }
        },
      };
    },

    async cleanUpStale() {
      const directory = fileSystem.importCacheDirectory();
      for (const uri of await fileSystem.listFiles(directory)) {
        if (!isAppOwnedCopy(uri)) continue;
        try {
          await fileSystem.deleteFile(uri);
        } catch (error) {
          console.warn('Could not delete a stale roster copy.', error);
        }
      }
    },
  };
}
