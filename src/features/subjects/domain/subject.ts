/**
 * A subject: what the Teacher teaches, for example "Mathematics" or
 * "Data Structures". An exam belongs to one subject and one class.
 */
export type Subject = {
  id: string;
  name: string;
  /** UTC ISO-8601 instants, as Date.prototype.toISOString() produces. */
  createdAt: string;
  updatedAt: string;
};

/** Long enough for "Edukasyon sa Pagpapakatao (Values Education)", short enough for a list row. */
export const SUBJECT_NAME_MAX_LENGTH = 60;
