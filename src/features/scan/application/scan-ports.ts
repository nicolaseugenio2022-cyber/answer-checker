import { ApplicationError } from '../../../core/application/errors';
import type { AnswerChoice } from '../../answer-keys/domain/answer-key';
import type { QuestionDetection } from '../domain/detection';
import type { CaptureProblem, GrayImage } from '../domain/gray-image';
import type { ScoredAnswer } from '../domain/scoring';
import type { SheetTemplate } from '../domain/template';

// ---------------------------------------------------------------------------
// Ports: what the scan use cases need from the device. Implemented in
// infrastructure; none of them may use the network.
// ---------------------------------------------------------------------------

/** What the reader concluded about one photo. */
export type SheetReading =
  | {
      ok: true;
      templateId: string;
      /** One decision for every question on the sheet, in order. */
      detections: QuestionDetection[];
      /** The sheet flattened and upright. */
      rectified: GrayImage;
    }
  | {
      ok: false;
      problem: CaptureProblem;
      /** With WRONG_SHEET: how many questions the photographed sheet was printed for. */
      sheetQuestionCount?: number;
    };

/**
 * Reads an answer sheet from a picture, on the device. The template says which
 * sheet is expected; a sheet printed for another number of questions is refused.
 */
export type SheetReader = {
  read(image: GrayImage, template: SheetTemplate): SheetReading;
};

/**
 * Where scan pictures live. Three kinds of file, all app-private:
 * - a capture: the photo as the camera wrote it, in the app's cache;
 * - a preview: the flattened sheet, in the app's cache, shown during review;
 * - a final image: the preview after the result was saved, in the app's
 *   documents, named by the result's id.
 * Nothing is ever written to the public gallery, and nothing outside the
 * app's own folders is ever deleted.
 */
export type ScanImageStore = {
  /** Loads a capture as brightness, reduced to the reader's working size. */
  loadCapture(captureUri: string): Promise<GrayImage>;
  /** Deletes a capture. Does nothing to a file outside the app's cache. */
  discardCapture(captureUri: string): Promise<void>;
  /** Writes the flattened sheet to the cache and returns where it is. */
  writePreview(image: GrayImage): Promise<string>;
  discardPreview(previewUri: string): Promise<void>;
  /**
   * Moves a preview to its permanent place and returns the path to store,
   * relative to the app's documents folder.
   */
  keepPreview(previewUri: string, resultId: string): Promise<string>;
  /** Deletes a final image by its stored path. */
  deleteFinal(imagePath: string): Promise<void>;
  /** The location to display a stored path from. */
  uriOf(imagePath: string): string;
  /**
   * Best effort: deletes captures and previews left by an interrupted
   * session, and final images that no result refers to.
   */
  cleanUp(referencedImagePaths: readonly string[]): Promise<void>;
};

/** A result as it is written: the header, every answer, and its one image. */
export type NewResult = {
  id: string;
  answerKeyId: string;
  studentId: string;
  /** The class the student was in when the sheet was scanned. */
  classId: string;
  score: number;
  total: number;
  templateId: string;
  capturedAt: string;
  createdAt: string;
  answers: readonly ScoredAnswer[];
  scanRecordId: string;
  /** Path of the final image, relative to the app's documents folder. */
  imagePath: string;
};

/** An earlier result of the same student with the same answer key. */
export type PreviousAttempt = { id: string; score: number; total: number; createdAt: string };

/** Local storage for results. Any method can fail with an error whose code is `DATABASE_ERROR`. */
export type ResultRepository = {
  /** Stores the result, all of its answers, and its scan record, or nothing. */
  save(result: NewResult): Promise<void>;
  /** Newest first. */
  listAttempts(answerKeyId: string, studentId: string): Promise<PreviousAttempt[]>;
  /** How many results each student has with one answer key. Students with none are absent. */
  countAttemptsByStudent(answerKeyId: string): Promise<Record<string, number>>;
  /** The stored path of every scan image, for finding orphaned files. */
  listImagePaths(): Promise<string[]>;
};

/** Hands a generated answer sheet to the device, to view, print, or send it. */
export type PrintableSheet = {
  /**
   * Opens the device's share sheet for a PDF made by the app. The file name is
   * what the Teacher sees. Resolves to false when the device cannot share files.
   */
  share(pdf: Uint8Array, fileName: string): Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Typed failures of the scan workflow
// ---------------------------------------------------------------------------

export type SelectionProblem =
  | 'INCOMPLETE'
  | 'SUBJECT_MISSING'
  | 'ANSWER_KEY_MISSING'
  /** The answer key belongs to another subject. */
  | 'ANSWER_KEY_NOT_OF_SUBJECT'
  /** The answer key has more questions than one sheet has room for. */
  | 'ANSWER_KEY_TOO_LONG'
  | 'CLASS_MISSING'
  /** The subject is not taught to the class. */
  | 'CLASS_NOT_ASSIGNED'
  | 'STUDENT_MISSING'
  /** The student belongs to another class. */
  | 'STUDENT_NOT_IN_CLASS';

/** The four choices do not fit together, or a chosen record is gone. Nothing was saved. */
export class ScanSelectionError extends ApplicationError {
  readonly problem: SelectionProblem;

  constructor(problem: SelectionProblem) {
    super('VALIDATION_ERROR', 'The scan selection is not valid.');
    this.name = 'ScanSelectionError';
    this.problem = problem;
  }
}

/** The photo cannot be read. No answers and no score were produced. */
export class CaptureRejectedError extends ApplicationError {
  readonly problem: CaptureProblem;
  /** With WRONG_SHEET: the question counts of the photographed sheet and of the answer key. */
  readonly sheetQuestionCount: number | null;
  readonly expectedQuestionCount: number | null;

  constructor(
    problem: CaptureProblem,
    counts: { sheet?: number; expected?: number } = {}
  ) {
    super('CAPTURE_REJECTED', 'The photo cannot be read.');
    this.name = 'CaptureRejectedError';
    this.problem = problem;
    this.sheetQuestionCount = counts.sheet ?? null;
    this.expectedQuestionCount = counts.expected ?? null;
  }
}

/** The answer key was edited after the sheet was read. The review must be redone. */
export class AnswerKeyChangedError extends ApplicationError {
  constructor() {
    super('ANSWER_KEY_CHANGED', 'The answer key changed while the sheet was being reviewed.');
    this.name = 'AnswerKeyChangedError';
  }
}

/** Questions still wait for the Teacher. */
export class IncompleteReviewError extends ApplicationError {
  readonly unresolvedCount: number;

  constructor(unresolvedCount: number) {
    super('VALIDATION_ERROR', 'Some questions still need review.');
    this.name = 'IncompleteReviewError';
    this.unresolvedCount = unresolvedCount;
  }
}

/** The student already has a result with this answer key and no second attempt was confirmed. */
export class DuplicateAttemptError extends ApplicationError {
  readonly previous: PreviousAttempt[];

  constructor(previous: PreviousAttempt[]) {
    super('DUPLICATE_ATTEMPT', 'The student already has a result for this answer key.');
    this.name = 'DuplicateAttemptError';
    this.previous = previous;
  }
}

/** The printable answer sheet could not be opened or shared. */
export class SheetShareError extends ApplicationError {
  /** TOO_LONG: the answer key has more questions than one sheet holds. */
  readonly reason: 'UNAVAILABLE' | 'FAILED' | 'TOO_LONG';

  constructor(reason: 'UNAVAILABLE' | 'FAILED' | 'TOO_LONG') {
    super('FILE_ERROR', 'The answer sheet could not be shared.');
    this.name = 'SheetShareError';
    this.reason = reason;
  }
}

/** A scan picture could not be read, written, or moved. No result was saved. */
export class ScanImageError extends ApplicationError {
  constructor() {
    super('FILE_ERROR', 'A scan picture could not be stored.');
    this.name = 'ScanImageError';
  }
}

/** The correct answers a draft was read against, kept to notice a later edit of the key. */
export type AnswerKeySnapshot = {
  id: string;
  name: string;
  questionCount: number;
  answers: readonly AnswerChoice[];
};
