/**
 * Migration 5: the database no longer caps the number of questions at 40.
 *
 * Migration 4 limited question_count and question_number to 40. The Teacher
 * decides how many questions a test has, so the schema now requires only a
 * positive number. A practical ceiling lives in the app
 * (ANSWER_KEY_MAX_QUESTIONS), where it can change without another migration.
 *
 * SQLite cannot alter a CHECK constraint, so the three tables that carried the
 * limit are rebuilt and their rows copied unchanged: answer_keys,
 * answer_key_items, and student_answers. Ids, names, answers, and timestamps
 * are kept. results and scan_records are untouched; they reference
 * answer_keys by name and keep doing so.
 *
 * The runner applies migrations on a connection where foreign-key enforcement
 * is off, which is what rebuilding tables requires; the tests run
 * PRAGMA foreign_key_check afterwards.
 */

const ISO_UTC =
  `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T` +
  `[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`;

const ID = `TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0)`;
const timestamp = (column: string) => `${column} TEXT NOT NULL CHECK (${column} GLOB ${ISO_UTC})`;
const ANSWER_LETTERS = `('A', 'B', 'C', 'D')`;

export const QUESTION_COUNT_UNBOUNDED_SQL = `
CREATE TABLE new_answer_keys (
  id ${ID},
  subject_id TEXT NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
  question_count INTEGER NOT NULL CHECK (question_count >= 1),
  ${timestamp('created_at')},
  ${timestamp('updated_at')}
) STRICT;

INSERT INTO new_answer_keys (id, subject_id, name, question_count, created_at, updated_at)
SELECT id, subject_id, name, question_count, created_at, updated_at FROM answer_keys;

CREATE TABLE new_answer_key_items (
  answer_key_id TEXT NOT NULL REFERENCES answer_keys (id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL CHECK (question_number >= 1),
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ${ANSWER_LETTERS}),
  PRIMARY KEY (answer_key_id, question_number)
) STRICT;

INSERT INTO new_answer_key_items (answer_key_id, question_number, correct_answer)
SELECT answer_key_id, question_number, correct_answer FROM answer_key_items;

CREATE TABLE new_student_answers (
  id ${ID},
  result_id TEXT NOT NULL REFERENCES results (id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL CHECK (question_number >= 1),
  state TEXT NOT NULL CHECK (state IN ('SELECTED', 'BLANK', 'MULTIPLE', 'UNCERTAIN')),
  selected_answer TEXT CHECK (selected_answer IN ${ANSWER_LETTERS}),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  teacher_corrected INTEGER NOT NULL DEFAULT 0 CHECK (teacher_corrected IN (0, 1)),
  UNIQUE (result_id, question_number),
  -- An answer letter is recorded exactly when one bubble was read as selected.
  CHECK ((state = 'SELECTED') = (selected_answer IS NOT NULL))
) STRICT;

INSERT INTO new_student_answers
SELECT id, result_id, question_number, state, selected_answer, is_correct, teacher_corrected
  FROM student_answers;

DROP TABLE answer_key_items;
DROP TABLE student_answers;
DROP TABLE answer_keys;

ALTER TABLE new_answer_keys RENAME TO answer_keys;
ALTER TABLE new_answer_key_items RENAME TO answer_key_items;
ALTER TABLE new_student_answers RENAME TO student_answers;

-- The indexes of answer_keys went with the old table.
CREATE UNIQUE INDEX idx_answer_keys_subject_id_name ON answer_keys (subject_id, name);
CREATE INDEX idx_answer_keys_created_at ON answer_keys (created_at);
`;
