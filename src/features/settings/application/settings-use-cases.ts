import { ApplicationError } from '../../../core/application/errors';
import {
  DEFAULT_PREFERENCES,
  isDeleteAllPhrase,
  normalizeTeacherName,
  parseAppearance,
  type AcademicCounts,
  type Appearance,
  type Preferences,
  type StorageSummary,
  type TeacherNameProblem,
} from '../domain/settings';

// ---------------------------------------------------------------------------
// Ports. Implemented in infrastructure; none of them may use the network.
// ---------------------------------------------------------------------------

/** The app's own named values. Any method can fail with an error whose code is `DATABASE_ERROR`. */
export type PreferenceStore = {
  /** Every stored value by its name. A setting never changed is absent. */
  readAll(): Promise<Record<string, string>>;
  write(key: string, value: string): Promise<void>;
};

/** The academic records as a whole. Any method can fail with an error whose code is `DATABASE_ERROR`. */
export type AcademicDataRepository = {
  counts(): Promise<AcademicCounts>;
  /** The stored path of every scan image that belongs to a saved result. */
  listImagePaths(): Promise<string[]>;
  /**
   * Physically deletes every academic row in one transaction, or nothing:
   * results with their answers and scan records, answer keys with their
   * items, students, assignments, classes, and subjects. The app's own
   * preferences are not academic data and are kept.
   */
  deleteAll(): Promise<void>;
};

/**
 * The app's private files. Every operation is confined to folders the app
 * itself created; nothing the Teacher owns elsewhere is ever read or removed.
 */
export type AppFiles = {
  /** Bytes used by the images of saved results. */
  measureScanImages(): Promise<number>;
  /**
   * Bytes used by what `cleanTemporary` would remove. `referencedImagePaths`
   * are the images that belong to saved results: they are never temporary.
   */
  measureTemporary(referencedImagePaths: readonly string[]): Promise<number>;
  /**
   * Removes abandoned captures, processing files, review previews, roster
   * import copies, generated answer-sheet files, files left by an interrupted
   * deletion, and images no result refers to. Returns the bytes freed.
   * Running it again removes nothing more.
   */
  cleanTemporary(referencedImagePaths: readonly string[]): Promise<number>;
  /** Removes every stored scan image and every temporary file. Called only after the rows are gone. */
  deleteEverything(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Typed failures
// ---------------------------------------------------------------------------

/** The display name cannot be stored. */
export class InvalidTeacherNameError extends ApplicationError {
  readonly problem: TeacherNameProblem;

  constructor(problem: TeacherNameProblem) {
    super('VALIDATION_ERROR', 'The display name is not valid.');
    this.name = 'InvalidTeacherNameError';
    this.problem = problem;
  }
}

/** The confirmation phrase was not typed exactly. Nothing was deleted. */
export class ConfirmationPhraseError extends ApplicationError {
  constructor() {
    super('VALIDATION_ERROR', 'The confirmation phrase does not match.');
    this.name = 'ConfirmationPhraseError';
  }
}

/** Temporary files could not be removed. No academic data was touched. */
export class CleanupError extends ApplicationError {
  constructor() {
    super('FILE_ERROR', 'Temporary files could not be removed.');
    this.name = 'CleanupError';
  }
}

const APPEARANCE_KEY = 'appearance';
const TEACHER_NAME_KEY = 'teacher_name';

type Dependencies = {
  preferences: PreferenceStore;
  academicData: AcademicDataRepository;
  files: AppFiles;
};

/** What "Delete all academic data" reports back. It names nothing that was deleted. */
export type DeleteAllOutcome = {
  /** False when the rows are gone but some files could not be removed yet; they are removed by a later cleanup. */
  filesRemoved: boolean;
};

export type SettingsUseCases = ReturnType<typeof createSettingsUseCases>;

export function createSettingsUseCases({ preferences, academicData, files }: Dependencies) {
  return {
    /** The stored preferences, with the default for anything never set or not understood. */
    async getPreferences(): Promise<Preferences> {
      const stored = await preferences.readAll();
      return {
        appearance: parseAppearance(stored[APPEARANCE_KEY]),
        teacherName: stored[TEACHER_NAME_KEY] ?? DEFAULT_PREFERENCES.teacherName,
      };
    },

    async setAppearance(appearance: Appearance): Promise<void> {
      await preferences.write(APPEARANCE_KEY, parseAppearance(appearance));
    },

    /**
     * Stores the optional display name, trimmed. An empty name clears it.
     * Returns the name as stored.
     * @throws InvalidTeacherNameError
     */
    async setTeacherName(input: string): Promise<string> {
      const normalized = normalizeTeacherName(input);
      if (!normalized.ok) throw new InvalidTeacherNameError(normalized.problem);
      await preferences.write(TEACHER_NAME_KEY, normalized.name);
      return normalized.name;
    },

    /**
     * How much is stored. It never throws: a part that cannot be read or
     * measured is null, and the rest is still returned.
     */
    async getStorageSummary(): Promise<StorageSummary> {
      const [counts, scanImageBytes, temporaryBytes] = await Promise.allSettled([
        academicData.counts(),
        files.measureScanImages(),
        academicData.listImagePaths().then((paths) => files.measureTemporary(paths)),
      ]);
      const valueOf = <T>(outcome: PromiseSettledResult<T>): T | null =>
        outcome.status === 'fulfilled' ? outcome.value : null;
      return {
        counts: valueOf(counts),
        scanImageBytes: valueOf(scanImageBytes),
        temporaryBytes: valueOf(temporaryBytes),
      };
    },

    /**
     * Removes the app's own temporary files and returns the bytes freed. The
     * images of saved results are read from the database first and are never
     * removed; if they cannot be read, nothing is cleaned.
     * @throws CleanupError
     */
    async cleanTemporaryFiles(): Promise<number> {
      try {
        return await files.cleanTemporary(await academicData.listImagePaths());
      } catch {
        throw new CleanupError();
      }
    },

    /**
     * Permanently deletes every academic record and every scan image.
     *
     * The rows go first, in one transaction: either all of them are deleted
     * or none is, so the academic data is never left half-deleted. Only then
     * are the files removed. A file that cannot be removed at that point
     * belongs to no record any more: it is never shown, and the next cleanup
     * removes it. The files are not removed first because a failed
     * transaction would then leave results without their images.
     *
     * The app's own preferences (appearance, display name) are kept.
     *
     * @throws ConfirmationPhraseError when `typedPhrase` is not exactly the
     *   required phrase, and errors with the code DATABASE_ERROR. In both
     *   cases nothing was deleted.
     */
    async deleteAllAcademicData(typedPhrase: string): Promise<DeleteAllOutcome> {
      if (!isDeleteAllPhrase(typedPhrase)) throw new ConfirmationPhraseError();
      await academicData.deleteAll();
      try {
        await files.deleteEverything();
        return { filesRemoved: true };
      } catch {
        return { filesRemoved: false };
      }
    },
  };
}
