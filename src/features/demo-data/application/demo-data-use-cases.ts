import { ApplicationError } from '../../../core/application/errors';
import type { Clock } from '../../../core/application/ports';
import { buildDemoData, type DemoData } from '../domain/demo-data';

/** What was removed with the demo data, for the confirmation message. */
export type DemoRemoval = { results: number; students: number; answerKeys: number };

/** Local storage of the demo records. Any method can fail with an error whose code is `DATABASE_ERROR`. */
export type DemoDataRepository = {
  /** Whether any demo record is stored. */
  exists(): Promise<boolean>;
  /**
   * Stores the whole set in one transaction, or nothing.
   * @throws DemoDataConflictError when a name or Student ID is already taken
   */
  insert(data: DemoData): Promise<void>;
  /**
   * Physically deletes every demo record, and everything saved under one, in
   * one transaction.
   */
  remove(): Promise<DemoRemoval>;
};

/** A demo name or Student ID is already used by one of the Teacher's own records. Nothing was added. */
export class DemoDataConflictError extends ApplicationError {
  constructor() {
    super('DUPLICATE_NAME', 'A demo name is already in use.');
    this.name = 'DemoDataConflictError';
  }
}

type Dependencies = { repository: DemoDataRepository; clock: Clock };

export type DemoDataUseCases = ReturnType<typeof createDemoDataUseCases>;

/**
 * Adds and removes the made-up records used to try the app out. A development
 * aid: the screens offer it only in development builds.
 */
export function createDemoDataUseCases({ repository, clock }: Dependencies) {
  return {
    hasDemoData(): Promise<boolean> {
      return repository.exists();
    },

    /**
     * Adds the demo set beside whatever is stored; nothing existing is changed.
     * Returns false, adding nothing, when demo data is already there.
     * @throws DemoDataConflictError
     */
    async addDemoData(): Promise<boolean> {
      if (await repository.exists()) return false;
      await repository.insert(buildDemoData(clock.now()));
      return true;
    },

    /**
     * Permanently deletes the demo records, together with anything the Teacher
     * saved under them: results scanned for a demo student or with a demo
     * answer key, students added to a demo class, answer keys added to a demo
     * subject. Records that are not connected to demo data are untouched.
     */
    removeDemoData(): Promise<DemoRemoval> {
      return repository.remove();
    },
  };
}
