/**
 * Migration 2: which subjects are taught to which classes.
 *
 * A many-to-many link between classes and subjects. A row means "this subject
 * is taught to this class"; the scanning flow will use it to offer only the
 * classes of the chosen subject.
 *
 * - The primary key (class_id, subject_id) makes a duplicate assignment
 *   impossible and serves lookups by class. The index serves lookups by
 *   subject.
 * - A row has no meaning without both of its parents, so it is deleted with
 *   either of them (CASCADE). That cascade reaches only this table: a class
 *   with students or exams, and a subject with exams, are still protected by
 *   the RESTRICT rules of migration 1.
 * - Same conventions as migration 1: STRICT, UTC ISO-8601 timestamp, no
 *   soft-delete or synchronization columns.
 */

const ISO_UTC =
  `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T` +
  `[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`;

export const CLASS_SUBJECTS_SQL = `
CREATE TABLE class_subjects (
  class_id TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (created_at GLOB ${ISO_UTC}),
  PRIMARY KEY (class_id, subject_id)
) STRICT;

CREATE INDEX idx_class_subjects_subject_id ON class_subjects (subject_id);
`;
