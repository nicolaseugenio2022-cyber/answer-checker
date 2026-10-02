import type { ResultDetail } from '../domain/result';
import type { ResultFilter, ResultLink } from '../domain/result-filter';
import {
  ResultImageError,
  ResultNotFoundError,
  type ResultCursor,
  type ResultImageStore,
  type ResultPage,
  type ResultsRepository,
  type StagedImage,
} from './results-ports';

type Dependencies = {
  repository: ResultsRepository;
  images: ResultImageStore;
};

/** How many results are read at a time. */
export const RESULT_PAGE_SIZE = 30;

export type ResultListRequest = {
  filter: ResultFilter;
  search: string;
  /** Where the previous page ended; omit for the first page. */
  after?: ResultCursor | null;
  limit?: number;
};

/** A complete result, and where its scan image can be displayed from. */
export type OpenedResult = {
  result: ResultDetail;
  /** Null when the stored scan image is unavailable. The result is complete without it. */
  imageUri: string | null;
};

export type ResultsUseCases = ReturnType<typeof createResultsUseCases>;

/**
 * Reading and permanently deleting saved results. There is deliberately no
 * operation that changes one: a result is a record of what was scanned.
 */
export function createResultsUseCases({ repository, images }: Dependencies) {
  // Deletions run one after another. Two at once for the same result (a
  // double tap) would otherwise both try to move the same image.
  let lastDeletion: Promise<unknown> = Promise.resolve();

  async function deleteNow(id: string): Promise<void> {
    const result = await repository.getById(id);
    if (!result) throw new ResultNotFoundError(id);

    let staged: StagedImage | null = null;
    if (result.imagePath !== null) {
      try {
        staged = await images.stage(result.imagePath);
      } catch {
        throw new ResultImageError();
      }
    }

    try {
      await repository.delete(id);
    } catch (error) {
      // Still a result: its image goes back. If even that fails, the file
      // waits in staging and is moved back the next time staging is settled.
      if (staged) await images.restore(staged).catch(() => undefined);
      throw error;
    }

    if (staged) await images.discard(staged).catch(() => undefined);
  }

  return {
    /** One page of results, newest first, within the filters and the search. */
    listResults({
      filter,
      search,
      after = null,
      limit = RESULT_PAGE_SIZE,
    }: ResultListRequest): Promise<ResultPage> {
      return repository.list({ filter, search: search.trim() }, limit, after);
    },

    /** How many results match, and how many are saved at all. */
    countResults(filter: ResultFilter, search: string): Promise<{ matching: number; total: number }> {
      return repository.count({ filter, search: search.trim() });
    },

    /** What the filters can offer: the combinations that have a result. */
    listFilterLinks(): Promise<ResultLink[]> {
      return repository.listLinks();
    },

    /**
     * One result with every answer. A missing or unreadable image does not
     * fail it: the result is returned with `imageUri` null.
     */
    async getResult(id: string): Promise<OpenedResult | null> {
      const result = await repository.getById(id);
      if (!result) return null;
      let imageUri: string | null = null;
      if (result.imagePath !== null) {
        imageUri = await images.displayUri(result.imagePath).catch(() => null);
      }
      return { result, imageUri };
    },

    /**
     * Permanently deletes a result with its answers, its scan record, and its
     * scan image. Nothing is kept: no flag, no copy.
     *
     * The database cannot undo a file deletion, so the image is not deleted
     * first. It is moved aside, the rows are deleted in one transaction, and
     * only then is the image destroyed:
     *
     * 1. The image is moved to the app's private staging folder. If that
     *    fails, nothing has changed.
     * 2. The rows are deleted. If that fails, the image is moved back and the
     *    result is exactly as it was.
     * 3. The staged image is deleted. If that fails, the result stays
     *    deleted; the leftover file is removed by `settleInterruptedDeletions`.
     *
     * A result whose image is already missing is deleted all the same. A
     * second request for a result that is already gone finds nothing.
     *
     * @throws ResultNotFoundError, ResultImageError, and errors with the code DATABASE_ERROR
     */
    deleteResult(id: string): Promise<void> {
      const deletion = lastDeletion.then(
        () => deleteNow(id),
        () => deleteNow(id)
      );
      lastDeletion = deletion.catch(() => undefined);
      return deletion;
    },

    /**
     * Best effort, when Results is opened: finishes or undoes deletions that
     * were interrupted. Never throws.
     */
    async settleInterruptedDeletions(): Promise<void> {
      try {
        await images.settleStaged(await repository.listImagePaths());
      } catch {
        // It runs again next time.
      }
    },
  };
}
