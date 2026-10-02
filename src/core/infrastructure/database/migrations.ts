import { INITIAL_SCHEMA_SQL } from './migrations/0001-initial-schema';
import { CLASS_SUBJECTS_SQL } from './migrations/0002-class-subjects';
import { STUDENT_NUMBER_UNIQUE_SQL } from './migrations/0003-student-number-unique';
import { ANSWER_KEYS_SQL } from './migrations/0004-answer-keys';
import { QUESTION_COUNT_UNBOUNDED_SQL } from './migrations/0005-question-count-unbounded';
import { SCAN_RESULTS_SQL } from './migrations/0006-scan-results';
import type { Migration } from './run-migrations';

/**
 * Ordered schema migrations. Versions start at 1 and increase by one.
 *
 * Once a build containing a migration has been installed on a device, that
 * migration is frozen: never edit or reorder it. Change the schema by appending
 * a new migration in its own file under ./migrations.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: INITIAL_SCHEMA_SQL },
  { version: 2, sql: CLASS_SUBJECTS_SQL },
  { version: 3, sql: STUDENT_NUMBER_UNIQUE_SQL },
  { version: 4, sql: ANSWER_KEYS_SQL },
  { version: 5, sql: QUESTION_COUNT_UNBOUNDED_SQL },
  { version: 6, sql: SCAN_RESULTS_SQL },
];
