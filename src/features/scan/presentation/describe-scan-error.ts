import {
  AnswerKeyChangedError,
  CaptureRejectedError,
  IncompleteReviewError,
  ScanImageError,
  ScanSelectionError,
  SheetShareError,
  type SelectionProblem,
} from '@/features/scan/application/scan-ports';
import type { CaptureProblem } from '@/features/scan/domain/gray-image';
import { MAX_SHEET_QUESTIONS } from '@/features/scan/domain/template';

/** What to change so the next photo can be read. One instruction per reason. */
const CAPTURE_ADVICE: Record<
  Exclude<CaptureProblem, 'WRONG_SHEET'>,
  { title: string; advice: string }
> = {
  IMAGE_TOO_SMALL: {
    title: 'The photo is too small',
    advice: 'Take the photo again with the camera, holding the phone above the whole sheet.',
  },
  MARKERS_NOT_FOUND: {
    title: 'Not all four corner squares are visible',
    advice:
      'Keep the whole sheet in the frame with its four black corner squares uncovered. Move the phone farther away and hold it flat above the sheet.',
  },
  SHEET_TOO_SMALL: {
    title: 'The sheet is too far away',
    advice: 'Move closer until the sheet nearly fills the frame.',
  },
  PERSPECTIVE_UNRELIABLE: {
    title: 'The sheet is at too steep an angle',
    advice: 'Hold the phone flat, directly above the sheet, and take the photo again.',
  },
  UNSUPPORTED_TEMPLATE: {
    title: 'This is not the Answer Checker answer sheet',
    advice:
      'Use the printable Answer Checker answer sheet, printed in black, with nothing covering the squares along its top edge.',
  },
  TOO_BLURRY: {
    title: 'The photo is blurred',
    advice: 'Hold the phone steady, let the camera focus on the sheet, and take the photo again.',
  },
  BAD_LIGHTING: {
    title: 'There is not enough light',
    advice:
      'Move to brighter, even light or turn on the flash. Avoid a dark shadow or a strong glare across the sheet.',
  },
};

const questions = (count: number) => `${count} ${count === 1 ? 'question' : 'questions'}`;

/** `counts` is used for a sheet printed for another number of questions. */
export function describeCaptureProblem(
  problem: CaptureProblem,
  counts: { sheet: number | null; expected: number | null } = { sheet: null, expected: null }
) {
  if (problem === 'WRONG_SHEET') {
    const { sheet, expected } = counts;
    return {
      title: 'This sheet is for a different answer key',
      advice:
        sheet !== null && expected !== null
          ? `This answer sheet has ${questions(sheet)}; the answer key has ${questions(expected)}. Use the sheet printed for this answer key, or choose the answer key this sheet was printed for.`
          : 'This answer sheet was printed for a different number of questions. Use the sheet printed for this answer key.',
    };
  }
  return CAPTURE_ADVICE[problem];
}

const SELECTION_MESSAGES: Record<SelectionProblem, string> = {
  INCOMPLETE: 'Choose a subject, an answer key, a class, and a student first.',
  SUBJECT_MISSING: 'That subject no longer exists. Choose another subject.',
  ANSWER_KEY_MISSING: 'That answer key no longer exists. Choose another answer key.',
  ANSWER_KEY_NOT_OF_SUBJECT: 'That answer key now belongs to another subject. Choose an answer key of this subject.',
  ANSWER_KEY_TOO_LONG:
    `That answer key has more than ${MAX_SHEET_QUESTIONS} questions, the most one answer sheet holds. It cannot be scanned.`,
  CLASS_MISSING: 'That class no longer exists. Choose another class.',
  CLASS_NOT_ASSIGNED: 'This subject is no longer taught to that class. Choose another class.',
  STUDENT_MISSING: 'That student no longer exists. Choose another student.',
  STUDENT_NOT_IN_CLASS: 'That student is now in another class. Choose the student again.',
};

export type ScanFailure = {
  /**
   * - `selection`: one of the four choices no longer holds; the Teacher must choose again.
   * - `capture`: the photo cannot be read; retake it.
   * - `stale`: the answer key changed during the review; the sheet must be scanned again.
   * - `review`: questions still wait for the Teacher.
   * - `failure`: unexpected; nothing was saved and the action can be retried.
   */
  kind: 'selection' | 'capture' | 'stale' | 'review' | 'failure';
  title: string;
  message: string;
};

/** What to tell the Teacher about a failed scan step. Never a raw camera, file, or database message. */
export function describeScanError(error: unknown): ScanFailure {
  if (error instanceof CaptureRejectedError) {
    const { title, advice } = describeCaptureProblem(error.problem, {
      sheet: error.sheetQuestionCount,
      expected: error.expectedQuestionCount,
    });
    return { kind: 'capture', title, message: advice };
  }
  if (error instanceof ScanSelectionError) {
    return {
      kind: 'selection',
      title: 'The selection changed',
      message: SELECTION_MESSAGES[error.problem],
    };
  }
  if (error instanceof AnswerKeyChangedError) {
    return {
      kind: 'stale',
      title: 'The answer key changed',
      message:
        'The answer key was edited after this sheet was read, so the review no longer matches it. Nothing was saved. Scan the sheet again.',
    };
  }
  if (error instanceof IncompleteReviewError) {
    return {
      kind: 'review',
      title: 'Some questions need review',
      message: 'Choose an answer, or Blank, for every question that is marked for review.',
    };
  }
  if (error instanceof SheetShareError) {
    return {
      kind: 'failure',
      title: 'The answer sheet could not be opened',
      message:
        error.reason === 'UNAVAILABLE'
          ? 'This phone cannot share files from the app.'
          : error.reason === 'TOO_LONG'
            ? `One answer sheet holds at most ${MAX_SHEET_QUESTIONS} questions. This answer key has more.`
            : 'The answer sheet could not be made. Try again.',
    };
  }
  if (error instanceof ScanImageError) {
    return {
      kind: 'failure',
      title: 'The scan could not be stored',
      message: 'The picture could not be saved on this device. Nothing was saved. Free some storage and try again.',
    };
  }
  return {
    kind: 'failure',
    title: 'Something went wrong',
    message: 'Something went wrong on this device. Nothing was saved. Try again.',
  };
}
