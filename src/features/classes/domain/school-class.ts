/**
 * A class: one complete group of students. Its single name carries the grade
 * or year, the course or strand, and the section, for example "Grade 11 STEM-A"
 * or "BSIT 1A". There are no separate course, strand, grade, or section fields.
 * A student belongs to one class; an exam belongs to one subject and one class.
 *
 * Named SchoolClass because `class` is a reserved word and `Class` reads like
 * a language construct.
 */
export type SchoolClass = {
  id: string;
  name: string;
  /** UTC ISO-8601 instants, as Date.prototype.toISOString() produces. */
  createdAt: string;
  updatedAt: string;
};

/** Room for "Grade 11 STEM-A (Morning Session)" while still fitting a list row. */
export const CLASS_NAME_MAX_LENGTH = 60;
