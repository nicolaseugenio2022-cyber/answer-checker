import { ApplicationError } from '../../../core/application/errors';
import type { ResultDetail, ResultSummary } from '../domain/result';
import type { ResultFilter, ResultLink } from '../domain/result-filter';

// ---------------------------------------------------------------------------
// Ports: what the results use cases need from the device. Implemented in
// infrastructure; none of them may use the network.
// ---------------------------------------------------------------------------

/** Where a page of the list ended: the position of its last result in the list's order. */
export type ResultCursor = { capturedAt: string; createdAt: string; id: string };

export type ResultQuery = {
  filter: ResultFilter;
  /** Already trimmed; empty for no search. */
  search: string;
};

export type ResultPage = {
  items: ResultSummary[];
  /** Pass it to read the next page; null when this page is the last. */
  next: ResultCursor | null;
};

/** Local storage of saved results. Any method can fail with an error whose code is `DATABASE_ERROR`. */
export type ResultsRepository = {
  /**
   * One page, newest first: by capture time, then save time, then id, all
   * descending. A fixed number of statements however many results there are.
   */
  list(query: ResultQuery, limit: number, after: ResultCursor | null): Promise<ResultPage>;
  /** How many results match the query, and how many there are at all. */
  count(query: ResultQuery): Promise<{ matching: number; total: number }>;
  /** Every combination of subject, answer key, class, and student that has a result. */
  listLinks(): Promise<ResultLink[]>;
  /** One result with its answers in question order and its image path, or null. */
  getById(id: string): Promise<ResultDetail | null>;
  /**
   * Physically deletes the result, its answers, and its scan record in one
   * transaction, or nothing.
   * @throws ResultNotFoundError
   */
  delete(id: string): Promise<void>;
  /** The stored path of every scan image, to tell a staged file that still has a result. */
  listImagePaths(): Promise<string[]>;
};

/** A scan image moved aside while its result is being deleted. */
export type StagedImage = { imagePath: string };

/**
 * The private scan images of saved results. Every path it is given comes from
 * the database and is checked: only a file directly inside the app's own
 * scans folder is ever shown, moved, or deleted.
 */
export type ResultImageStore = {
  /** Where to display the image from, or null when the path is not a scan image or the file is gone. */
  displayUri(imagePath: string): Promise<string | null>;
  /**
   * Moves the image to the app's private deletion-staging folder. Returns null
   * when there is nothing to move: the path is not a scan image (it is then
   * left untouched) or the file is already gone.
   */
  stage(imagePath: string): Promise<StagedImage | null>;
  /** Moves a staged image back to where it was. */
  restore(staged: StagedImage): Promise<void>;
  /** Deletes a staged image for good. */
  discard(staged: StagedImage): Promise<void>;
  /**
   * Settles staged files left by an interrupted deletion: one whose result
   * still exists is moved back, every other one is deleted.
   */
  settleStaged(referencedImagePaths: readonly string[]): Promise<void>;
};

// ---------------------------------------------------------------------------
// Typed failures
// ---------------------------------------------------------------------------

/** The result does not exist: it was never saved, or it is already deleted. */
export class ResultNotFoundError extends ApplicationError {
  readonly id: string;

  constructor(id: string) {
    super('NOT_FOUND', 'The result does not exist.');
    this.name = 'ResultNotFoundError';
    this.id = id;
  }
}

/** The scan image could not be set aside for deletion. Nothing was deleted. */
export class ResultImageError extends ApplicationError {
  constructor() {
    super('FILE_ERROR', 'The stored scan image could not be removed.');
    this.name = 'ResultImageError';
  }
}
