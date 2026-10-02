import { RecordNotFoundError } from '../../../core/application/errors';
import type { Clock, IdGenerator } from '../../../core/application/ports';
import { nameKey } from '../../../core/domain/record-name';
import {
  changesScoring,
  proposeCopyName,
  validateAnswerKeyInput,
  type AnswerKey,
  type AnswerKeyInput,
  type ValidAnswerKeyInput,
} from '../domain/answer-key';
import {
  InvalidAnswerKeyError,
  type AnswerKeyDetails,
  type AnswerKeyRepository,
} from './answer-key-repository';

type Dependencies = {
  repository: AnswerKeyRepository;
  clock: Clock;
  idGenerator: IdGenerator;
};

export type AnswerKeyFilter = {
  /** Only this subject. Null or omitted: every subject. */
  subjectId?: string | null;
  /** Matches the name, ignoring letter case. */
  search?: string;
};

/** The key itself, without what a list shows beside it. */
function toAnswerKey(details: AnswerKeyDetails): AnswerKey {
  return {
    id: details.id,
    subjectId: details.subjectId,
    name: details.name,
    questionCount: details.questionCount,
    answers: details.answers,
    createdAt: details.createdAt,
    updatedAt: details.updatedAt,
  };
}

export type AnswerKeyUseCases = ReturnType<typeof createAnswerKeyUseCases>;

export function createAnswerKeyUseCases({ repository, clock, idGenerator }: Dependencies) {
  /** Returns the input in its stored form, or throws InvalidAnswerKeyError. */
  function requireValid(input: AnswerKeyInput): ValidAnswerKeyInput {
    const result = validateAnswerKeyInput(input);
    if (!result.ok) throw new InvalidAnswerKeyError(result.problems);
    return result.value;
  }

  /** @throws InvalidAnswerKeyError, SubjectNotFoundError, DuplicateNameError */
  async function createAnswerKey(input: AnswerKeyInput): Promise<AnswerKey> {
    const valid = requireValid(input);
    const now = clock.now();
    const answerKey: AnswerKey = {
      id: idGenerator.newId(),
      ...valid,
      createdAt: now,
      updatedAt: now,
    };
    await repository.create(answerKey);
    return answerKey;
  }

  /**
   * What a copy of the key would be, with a name no key of its subject has
   * yet. Nothing is stored: the Teacher may change the name first and then
   * saves it with createAnswerKey.
   * @throws RecordNotFoundError
   */
  async function draftDuplicate(id: string): Promise<ValidAnswerKeyInput> {
    const original = await repository.getById(id);
    if (!original) throw new RecordNotFoundError(id);
    const siblings = await repository.list(original.subjectId);
    return {
      name: proposeCopyName(
        original.name,
        siblings.map((sibling) => sibling.name)
      ),
      subjectId: original.subjectId,
      questionCount: original.questionCount,
      answers: [...original.answers],
    };
  }

  return {
    /**
     * Complete keys, ordered by subject name, key name, then id. With
     * `subjectId`, this is what the Scan flow shows after a subject is chosen.
     */
    async listAnswerKeys(filter: AnswerKeyFilter = {}): Promise<AnswerKeyDetails[]> {
      const answerKeys = await repository.list(filter.subjectId ?? null);
      const wanted = nameKey((filter.search ?? '').trim());
      return wanted.length === 0
        ? answerKeys
        : answerKeys.filter((answerKey) => nameKey(answerKey.name).includes(wanted));
    },

    /** The key with all of its answers in question order, or null. */
    getAnswerKey(id: string): Promise<AnswerKeyDetails | null> {
      return repository.getById(id);
    },

    createAnswerKey,

    /**
     * Saves the whole key, or nothing. Saving without a change does nothing,
     * not even to `updatedAt`. Once results were scored with the key, only its
     * name may change; old results are never rescored.
     * @throws InvalidAnswerKeyError, RecordNotFoundError, SubjectNotFoundError,
     *   DuplicateNameError, AnswerKeyLockedError
     */
    async updateAnswerKey(id: string, input: AnswerKeyInput): Promise<AnswerKey> {
      const valid = requireValid(input);
      const current = await repository.getById(id);
      if (!current) throw new RecordNotFoundError(id);
      if (current.name === valid.name && !changesScoring(current, valid)) {
        return toAnswerKey(current);
      }
      return repository.update(id, valid, clock.now());
    },

    draftDuplicate,

    /**
     * Stores a copy of the key under a new id, with the proposed name or the
     * one given. Results of the original are not copied: the copy is unused.
     * @throws RecordNotFoundError, InvalidAnswerKeyError, DuplicateNameError
     */
    async duplicateAnswerKey(id: string, name?: string): Promise<AnswerKey> {
      const draft = await draftDuplicate(id);
      return createAnswerKey(name === undefined ? draft : { ...draft, name });
    },

    /** Whether saved results were scored with the key, which freezes its scoring. */
    async hasResults(id: string): Promise<boolean> {
      return (await repository.countResults(id)) > 0;
    },

    countResults(id: string): Promise<number> {
      return repository.countResults(id);
    },

    /**
     * Permanent: the key and its answers are physically deleted and cannot be
     * restored. Blocked while saved results were scored with it; those are
     * never deleted here.
     * @throws RecordNotFoundError, AnswerKeyInUseError
     */
    deleteAnswerKey(id: string): Promise<void> {
      return repository.delete(id);
    },
  };
}
