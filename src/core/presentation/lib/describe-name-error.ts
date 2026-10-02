import {
  DuplicateNameError,
  InvalidNameError,
  RecordNotFoundError,
} from '@/core/application/errors';

/**
 * What to tell the Teacher about a failed action, and how the screen reacts:
 * - `invalid`: the input can be corrected; show the message at the field.
 * - `blocked`: deletion is not allowed while other records depend on this one.
 * - `missing`: the record is gone; refresh the list.
 * - `failure`: unexpected; nothing was changed and the action can be retried.
 */
export type ErrorDescription = {
  kind: 'invalid' | 'blocked' | 'missing' | 'failure';
  message: string;
};

/** Words for the failures every named record shares. Never exposes a raw database message. */
export function describeNameError(error: unknown, noun: string): ErrorDescription {
  if (error instanceof InvalidNameError) {
    return {
      kind: 'invalid',
      message:
        error.problem === 'EMPTY'
          ? `Enter a name for the ${noun}.`
          : `Use ${error.maxLength} characters or fewer.`,
    };
  }
  if (error instanceof DuplicateNameError) {
    return {
      kind: 'invalid',
      message: `A ${noun} named “${error.duplicateName}” already exists.`,
    };
  }
  if (error instanceof RecordNotFoundError) {
    return { kind: 'missing', message: `That ${noun} no longer exists.` };
  }
  return {
    kind: 'failure',
    message: 'Something went wrong on this device. Nothing was changed. Try again.',
  };
}

/** "1 student", "3 students". */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
