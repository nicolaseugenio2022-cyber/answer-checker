# Application API

Last reviewed: 2026-10-02

This document describes the application's internal contracts: the boundaries between UI, application use cases, OMR, camera, and local storage. The application is offline-only, so every contract here is an in-process contract on the device. There are no network routes; see [api-routes.md](./api-routes.md).

> **Status.** Implemented: the [Database Contract](#database-contract), the [Subjects and Classes Contract](#subjects-and-classes-contract), the [Subject-to-Class Assignment Contract](#subject-to-class-assignment-contract), the [Student Contract](#student-contract), the [Answer Key Contract](#answer-key-contract), and the implemented part of the [Error Model](#error-model). Everything else is a **Planned Contract**: no OMR, camera, scoring, or result code exists, and its names and shapes may change when built.

## API Philosophy

- "API" here does not mean HTTP. The app is offline-only, so all of its contracts are in-process TypeScript boundaries.
- The UI calls application use cases. Use cases call repositories and, later, the OMR module and the camera. The UI does not talk to SQLite or OpenCV directly.
- Every operation completes against local resources only: the local SQLite database, local files, the camera, and on-device OMR. No contract may use the network.
- IDs are device-generated UUIDs.
- Operations return typed results or throw typed errors from the [Error Model](#error-model); they do not fail silently, and raw SQLite messages never reach the Teacher.
- There is one role, Teacher. No contract takes a role or permission argument.
- Contracts follow the clean architecture layers in [source-of-truth.md](./source-of-truth.md#clean-architecture-layers): use cases and repository contracts live in a feature's application layer, their SQLite implementations in its infrastructure layer.
- Use cases receive a `Clock` (`now()` returns a UTC ISO-8601 string) and an `IdGenerator` (`newId()`) by injection. The app supplies the system clock and `expo-crypto`'s `randomUUID`; tests supply fixed values.

## Application Use Cases

| Area | Operations | Status |
| --- | --- | --- |
| Subjects | `listSubjects()`, `addSubject(name)`, `renameSubject(id, name)`, `deleteSubject(id)` | Implemented and verified |
| Classes | `listClasses()`, `addClass(name)`, `renameClass(id, name)`, `deleteClass(id)` | Implemented and verified |
| Subject-to-Class assignments | `listSubjectsForClass(classId)`, `listClassesForSubject(subjectId)`, `isSubjectAssignedToClass(classId, subjectId)`, `assignSubjectToClass(classId, subjectId)`, `removeSubjectFromClass(classId, subjectId)`, `replaceSubjectsForClass(classId, subjectIds)`, `countSubjectsByClass()`, `countClassesBySubject()` | Implemented |
| Students | `listStudents({ classId, search })`, `getStudent(id)`, `addStudent(input)`, `updateStudent(id, input)`, `deleteStudent(id)`, `pickRoster()`, `prepareRoster(fileName, text)`, `importStudents(inputs)` | Implemented and verified |
| Answer Keys | `listAnswerKeys({ subjectId, search })`, `getAnswerKey(id)`, `createAnswerKey(input)`, `updateAnswerKey(id, input)`, `draftDuplicate(id)`, `duplicateAnswerKey(id, name?)`, `hasResults(id)`, `countResults(id)`, `deleteAnswerKey(id)` | Implemented and verified |
| Scanning | capture, process, review | Planned |
| Results | score, save, list, delete | Planned |

All delete operations are permanent deletions as defined in the [Permanent Deletion Contract](#permanent-deletion-contract).

## Database Contract

Implemented in `src/core/infrastructure/database/`.

### Bootstrap

- `DatabaseProvider` wraps the app in `src/app/_layout.tsx`. On native it opens `answer-checker.db` and finishes initialization before any screen renders. On web it is a pass-through and opens no database.
- Initialization sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`, confirms that foreign keys are on, then runs migrations. If foreign keys cannot be enabled, initialization fails with `DATABASE_ERROR`.
- `useDatabaseIfAvailable()` returns the connection, or null on web. The composition root builds use cases only when it is not null.

### Migrations

- `runMigrations(db, migrations)` reads `PRAGMA user_version`, applies each pending migration, and returns the resulting version.
  - Migration versions must be 1, 2, 3 and so on, in order; anything else throws before the database is touched.
  - Each migration and its version bump commit in one exclusive transaction. A failed migration rolls back completely and leaves the previous version in place.
  - A database whose version is higher than the app knows is refused rather than downgraded.
- `MIGRATIONS` in `migrations.ts` is the only place schema is defined, one file per migration under `migrations/`.
- Migrations are forward-only and must preserve existing local data. A migration that has run on a device is never edited.

| Version | File | Change | Device status |
| --- | --- | --- | --- |
| 1 | `0001-initial-schema.ts` | Creates `subjects`, `classes`, `students`, and the exam model: `exams`, `exam_questions`, a per-question `answer_keys`, `exam_results`, `student_answers`, `scan_records` | Verified on an Android 14 emulator and a physical phone |
| 2 | `0002-class-subjects.ts` | Adds `class_subjects` | Has run on a physical phone |
| 3 | `0003-student-number-unique.ts` | Adds a unique index on `students.student_number`, ignoring letter case: a Student ID is unique in the whole app, not only within a class | Has run on a physical phone |
| 4 | `0004-answer-keys.ts` | Replaces the exam model: creates `answer_keys` (per subject) and `answer_key_items`, renames `exam_results` to `results`, rebuilds `student_answers` and `scan_records`, and drops `exams`, `exam_questions`, and the old `answer_keys` | Has run on a physical phone, with no legacy rows to convert |

Migration 4 converts legacy data instead of discarding it:

- An exam becomes an Answer Key with the same ID, Subject, question count, and timestamps. Its class is dropped.
- The exam title becomes the name. Where two exams of one Subject had the same title, the class name is appended, as in "Midterm (BSIT 1A)".
- Each question with its correct letter becomes an item. Result rows keep their IDs and reference the Answer Key.
- It stops and rolls back, leaving version 3 and every row intact, when a legacy exam cannot be converted exactly: a question count outside 1 to 40, questions that are not exactly 1 to the count with an answer each, a question worth other than one point, or two names that are still equal after the class name is appended.

The Node tests cover a fresh install, the upgrade from versions 1, 2, and 3, each rollback case, `PRAGMA foreign_key_check`, and `PRAGMA integrity_check`.

### Schema conventions

- Every table is `STRICT`.
- Primary keys are `TEXT` UUIDs named `id`, except `class_subjects`, whose primary key is `(class_id, subject_id)`, and `answer_key_items`, whose primary key is `(answer_key_id, question_number)`.
- Timestamps are `TEXT`, checked against the UTC ISO-8601 form `YYYY-MM-DDTHH:MM:SS.sssZ`.
- Booleans are `INTEGER` 0 or 1.
- Subject, class, and answer key names are `COLLATE NOCASE`.
- Answer letters are restricted to `A`, `B`, `C`, `D`. `question_count` and `question_number` are between 1 and 40.
- No table has a soft-delete, archive, tombstone, or synchronization column.

### Indexes

| Index | Table and columns |
| --- | --- |
| `idx_students_class_id_full_name` | `students (class_id, full_name)` |
| `idx_students_student_number` (unique) | `students (student_number COLLATE NOCASE)` |
| `idx_class_subjects_subject_id` | `class_subjects (subject_id)` |
| `idx_answer_keys_subject_id_name` (unique) | `answer_keys (subject_id, name)` |
| `idx_answer_keys_created_at` | `answer_keys (created_at)` |
| `idx_results_answer_key_id_student_id` (unique) | `results (answer_key_id, student_id)` |
| `idx_results_student_id` | `results (student_id)` |
| `idx_results_created_at` | `results (created_at)` |

`students` also keeps the table constraint `UNIQUE (class_id, student_number)` from migration 1; the app-wide index makes it redundant.

### Foreign keys and delete rules

| Child column | Parent | On delete |
| --- | --- | --- |
| `students.class_id` | `classes.id` | RESTRICT |
| `answer_keys.subject_id` | `subjects.id` | RESTRICT |
| `results.answer_key_id` | `answer_keys.id` | RESTRICT |
| `results.student_id` | `students.id` | RESTRICT |
| `answer_key_items.answer_key_id` | `answer_keys.id` | CASCADE |
| `student_answers.result_id` | `results.id` | CASCADE |
| `scan_records.result_id` | `results.id` | CASCADE |
| `class_subjects.class_id` | `classes.id` | CASCADE |
| `class_subjects.subject_id` | `subjects.id` | CASCADE |

### Transactions

- `runInTransaction(db, task)` runs a task in one `BEGIN IMMEDIATE` transaction on the initialized connection: everything commits together or nothing does. Calls on the same connection run one after another.
- Data writes must use it. `expo-sqlite`'s `withExclusiveTransactionAsync` opens a second connection on which foreign keys are off, so `RESTRICT` and `CASCADE` would not apply there. Only the migration runner uses that method.
- If the task throws, the transaction rolls back and the task's error is rethrown.

## Repository Rules

Implemented for Subjects, Classes, assignments, Students, and Answer Keys; binding for every later repository.

- Repositories are the only code that issues SQL. They use raw `expo-sqlite` through a small `SqlConnection` type, so the same code runs against Node's SQLite in tests. Drizzle ORM is undecided and not installed.
- Values are passed as parameters. Nothing supplied by the Teacher is placed in SQL text.
- Multi-step writes and deletion checks run inside `runInTransaction`.
- A list is read with a fixed number of statements, however many records it returns. A batch is checked and inserted with a few statements, not one per record.
- Only typed errors leave a repository: application errors pass through, and any other failure is wrapped as `DATABASE_ERROR` with the original kept as its cause.
- No repository touches the network.

## Subjects and Classes Contract

Implemented and verified on a physical Android phone. The two features have the same shape.

A record is `{ id, name, createdAt, updatedAt }`.

| Operation | Behavior | Errors |
| --- | --- | --- |
| `listSubjects()` / `listClasses()` | All records, alphabetical ignoring letter case, in a stable order | `DATABASE_ERROR` |
| `addSubject(name)` / `addClass(name)` | Trims the name, validates it, generates the ID and both timestamps, stores and returns the record | `VALIDATION_ERROR`, `DUPLICATE_NAME`, `DATABASE_ERROR` |
| `renameSubject(id, name)` / `renameClass(id, name)` | Trims and validates. Keeps `createdAt`, sets `updatedAt`. Renaming to the current name changes nothing. Changing only letter case is allowed | `VALIDATION_ERROR`, `NOT_FOUND`, `DUPLICATE_NAME`, `DATABASE_ERROR` |
| `deleteSubject(id)` / `deleteClass(id)` | Physically deletes the record if nothing independent depends on it | `NOT_FOUND`, `IN_USE`, `DATABASE_ERROR` |

Name rules:

- Surrounding whitespace is removed.
- An empty or whitespace-only name is rejected.
- The maximum is 60 characters, counted as characters rather than UTF-16 units.
- Names are unique ignoring letter case. The repository compares names itself inside the write transaction, because SQLite's `NOCASE` folds only ASCII letters; the `UNIQUE` constraint remains the final safeguard.

Deletion restrictions:

- A Subject with Answer Keys is not deleted. The error carries `answerKeyCount`.
- A Class with Students is not deleted. The error carries `studentCount`. An Answer Key does not belong to a Class and never blocks one.
- The check and the delete run in the same transaction. Nothing is deleted automatically except the record's own `class_subjects` rows.

Repository operations behind these use cases: `list`, `getById`, `create`, `rename`, `delete`.

## Subject-to-Class Assignment Contract

Implemented.

| Operation | Behavior |
| --- | --- |
| `listSubjectsForClass(classId)` | Subjects assigned to the class, alphabetical ignoring letter case |
| `listClassesForSubject(subjectId)` | Classes assigned to the subject, alphabetical ignoring letter case. The Scan flow will call this after the Teacher picks a Subject |
| `isSubjectAssignedToClass(classId, subjectId)` | True or false |
| `assignSubjectToClass(classId, subjectId)` | Adds the assignment. If it already exists nothing changes and the first timestamp is kept |
| `removeSubjectFromClass(classId, subjectId)` | Physically deletes the assignment row. If it does not exist nothing changes |
| `replaceSubjectsForClass(classId, subjectIds)` | Makes the given set the complete selection for the class in one transaction. Assignments that stay keep their timestamp. If any step fails, nothing changes |
| `countSubjectsByClass()` / `countClassesBySubject()` | Counts by ID, for the row summaries. Records with no assignment are absent |

- An unknown class throws `ClassNotFoundError`, an unknown subject `SubjectNotFoundError`; both carry the code `NOT_FOUND`.
- A duplicate assignment is impossible: `(class_id, subject_id)` is the primary key.
- Removing assignments never deletes a Subject, Class, Student, or Answer Key.
- The only editing workflow is Classes → Manage subjects, which calls `replaceSubjectsForClass`.

## Student Contract

Implemented and verified on a physical Android phone.

A Student is `{ id, studentNumber, fullName, classId, createdAt, updatedAt }`. `studentNumber` is the "Student ID" the Teacher sees. Lists return it with `className`.

| Operation | Behavior | Errors |
| --- | --- | --- |
| `listStudents({ classId, search })` | Students of one Class or of all, ordered by Class name, full name, Student ID, then ID. `search` matches the Student ID or the full name, ignoring letter case | `DATABASE_ERROR` |
| `getStudent(id)` | One Student with its Class name, or null | `DATABASE_ERROR` |
| `addStudent(input)` | Trims and validates, generates the ID and timestamps, stores and returns the Student | `VALIDATION_ERROR`, `NOT_FOUND` (class), `DUPLICATE_STUDENT_ID`, `DATABASE_ERROR` |
| `updateStudent(id, input)` | Changes the Student ID, the full name, the Class, or any of them. Keeps `createdAt`. Saving without a change does nothing | `VALIDATION_ERROR`, `NOT_FOUND`, `DUPLICATE_STUDENT_ID`, `DATABASE_ERROR` |
| `deleteStudent(id)` | Physically deletes the Student when no Result belongs to it | `NOT_FOUND`, `IN_USE` (with `resultCount`), `DATABASE_ERROR` |

Rules:

- Student ID: trimmed, required, at most 32 characters, unique across all Students ignoring letter case. The repository compares IDs itself inside the write transaction; the unique index is the final safeguard.
- Full name: trimmed, required, at most 100 characters, counted as characters.
- Class: required and must exist. A missing Class is `ClassNotFoundError`.
- A Student has no Subject and no grade, course, strand, or section field.

### Roster import

| Operation | Behavior |
| --- | --- |
| `pickRoster()` | Opens the device file picker, reads the chosen file, releases it, and returns a checked draft, or null when the picker was closed. Stores nothing |
| `prepareRoster(fileName, text)` | Reads CSV text and checks it against the stored Students and Classes. Returns the draft. Stores nothing |
| `resolveRoster(draft, selection)` | Pure function: which rows would be imported with the Teacher's choice of Class or of Class per group |
| `importStudents(inputs)` | Validates every row again and stores them in one transaction: all, or none. Returns the number added |

CSV rules:

- UTF-8, with or without a byte-order mark. LF, CRLF, or CR line endings.
- Header names are trimmed and compared ignoring letter case. Columns may be in any order; other columns are ignored.
- `student_id,full_name` is a single-Class roster. Adding `grade_and_section` and `course` makes it a multi-Class roster; having only one of the two is an error.
- Quoted values, commas and line breaks inside quotes, and `""` for a quote are supported. Completely blank rows are ignored.
- Every reported row carries its line number in the file, counting the header as 1.

A draft separates:

| List | Meaning |
| --- | --- |
| `rows` | Valid and importable once a Class is chosen |
| `invalid` | Missing or too-long Student ID or name, no class values, or more values than columns |
| `duplicates` | Student ID already used by an earlier row of the file. The first row is kept |
| `existing` | Student ID already stored. The stored Student is not changed |
| `groups` | Each distinct `grade_and_section` plus `course`, with a suggested Class when exactly one Class matches exactly |

A file that cannot be used at all throws `ROSTER_FILE_ERROR` with a reason: empty, malformed (with the line), missing headers (named), a repeated header, too large (over 1 MB), or unreadable.

### Roster file port

`RosterFilePicker` is the application port; `createRosterFilePicker(fileSystem)` implements it over five file operations, and `expoRosterFileSystem` supplies them with `expo-document-picker` and `expo-file-system`.

- The picker copies the chosen file into the app's cache folder `DocumentPicker`. The app reads that copy.
- `release()` deletes the copy and is called in a `finally`, so it runs after success, a parsing error, a read error, an oversized file, and a database error alike.
- Only a path inside that cache folder is ever deleted. Any other URI is read and left alone.
- `cleanUpStale()` empties the folder before each pick, removing copies left by an interrupted session.
- Nothing of the file reaches SQLite: not its contents, its name, or its path.

## Answer Key Contract

Implemented and verified on a physical Android phone.

An Answer Key is `{ id, subjectId, name, questionCount, answers, createdAt, updatedAt }`. `answers` holds one `AnswerChoice` (`'A' | 'B' | 'C' | 'D'`) per question in order: index 0 is question 1. Lists return it with `subjectName` and `resultCount`.

| Operation | Behavior | Errors |
| --- | --- | --- |
| `listAnswerKeys({ subjectId, search })` | Complete keys of one Subject or of all, ordered by Subject name, key name, then ID. `search` matches the name. With `subjectId`, this is what the Scan flow calls | `DATABASE_ERROR` |
| `getAnswerKey(id)` | One complete key with its answers in question order, or null | `DATABASE_ERROR` |
| `createAnswerKey(input)` | Validates, generates the ID and timestamps, stores header and items together | `VALIDATION_ERROR`, `NOT_FOUND` (subject), `DUPLICATE_NAME`, `DATABASE_ERROR` |
| `updateAnswerKey(id, input)` | Replaces the whole key. Keeps `createdAt`. Saving without a change does nothing | `VALIDATION_ERROR`, `NOT_FOUND`, `DUPLICATE_NAME`, `ANSWER_KEY_LOCKED`, `DATABASE_ERROR` |
| `draftDuplicate(id)` | Returns a copy as unsaved input with a free name. Stores nothing | `NOT_FOUND` |
| `duplicateAnswerKey(id, name?)` | Stores a copy under a new ID. Copies no Results | `NOT_FOUND`, `VALIDATION_ERROR`, `DUPLICATE_NAME` |
| `countResults(id)`, `hasResults(id)` | How many saved Results were scored with the key | `DATABASE_ERROR` |
| `deleteAnswerKey(id)` | Physically deletes the key and its items when no Result uses it | `NOT_FOUND`, `IN_USE` (with `resultCount`), `DATABASE_ERROR` |

Rules:

- Name: trimmed, required, at most 60 characters, unique within its Subject ignoring letter case. The same name is allowed under another Subject. A rename that changes only letter case is allowed.
- Subject: required and must exist. A missing Subject is `SubjectNotFoundError`.
- Question count: an integer from 1 to 40.
- Answers: exactly one of A, B, C, D for every question from 1 to the count. A missing answer, another letter, or the wrong number of answers is `VALIDATION_ERROR`, and the error names the questions.
- A key is written whole in one transaction. If writing the items fails, the header is rolled back.
- A key is read whole. Listing uses two statements however many keys there are. A stored key with a gap is refused with `DATABASE_ERROR` rather than completed with a guess.
- An Answer Key has no Class.

Historical integrity:

- When `resultCount` is above zero, a change of Subject, question count, or any answer throws `AnswerKeyLockedError` (`ANSWER_KEY_LOCKED`) with the count. Nothing is changed, including a name sent with the blocked change.
- The name alone can still be changed.
- The check runs inside the write transaction. Results are never rescored.
- The supported way to revise a used key is to duplicate it.

## Scan Selection Contract

Planned (Stage 5). The four reads exist; no scan use case calls them yet.

1. `listSubjects()`
2. `listAnswerKeys({ subjectId })`
3. `listClassesForSubject(subjectId)`
4. `listStudents({ classId })`
5. Scan, review, score, save

- Changing the Subject clears an Answer Key, Class, and Student that no longer match. Changing the Class clears a Student that no longer matches.
- The save use case checks again that the Answer Key belongs to the Subject, that the Class is assigned to the Subject, and that the Student belongs to the Class. A violation is `VALIDATION_ERROR`.

## OMR Contract

Planned.

**Input (conceptual):**

- A captured image of a standardized answer sheet.
- The sheet template for the selected Answer Key: number of questions and bubble layout relative to the four alignment markers.

**Processing:** detect sheet, detect alignment markers, perspective correction, grayscale, thresholding, locate bubble regions, measure fill percentage, determine selected answers, validate. All on-device and deterministic: the same image and template produce the same output.

**Output (conceptual):**

```json
{
  "status": "success",
  "questions": [
    {
      "questionNumber": 1,
      "state": "SELECTED",
      "selectedAnswer": "B",
      "confidence": 0.97
    },
    {
      "questionNumber": 2,
      "state": "BLANK",
      "selectedAnswer": null,
      "confidence": 0.99
    }
  ]
}
```

**States:**

| State | Meaning | Scoring before review |
| --- | --- | --- |
| `SELECTED` | Exactly one bubble is clearly filled | Compared with the Answer Key |
| `BLANK` | No bubble is filled | Flagged; incorrect unless Teacher corrects |
| `MULTIPLE` | More than one bubble is filled | Flagged; incorrect unless Teacher corrects |
| `UNCERTAIN` | Fill levels are too ambiguous to decide | Flagged; must be resolved by Teacher |

**Rules:**

- OMR never guesses silently. Ambiguity becomes `UNCERTAIN`, not a best-effort `SELECTED`.
- If the sheet or markers cannot be found, the whole call fails with `OMR_FAILED`; it does not return partial answers.
- The number of returned questions must equal the template's question count.
- Only A–D bubbles and alignment markers are read. Handwritten names and subjects are not recognized.
- An identity read from a future QR code or bubbled Student ID is a suggestion that the Teacher confirms; it is never saved unconfirmed.
- No fill thresholds are defined. Values must come from calibration against real sheets, pencils and pens, lighting, cameras, and erasures. Thresholds should be configuration, not scattered constants.
- OMR does not score. It reports marks; scoring is a separate contract.
- No AI/LLM inference and no remote call.

## Camera Contract

Planned.

- Capture returns a reference to a locally stored image (a file URI), not image data sent anywhere.
- Camera permission is requested when the Teacher first opens the scanner. Denial produces `PERMISSION_ERROR` with guidance to enable it in system settings.
- Hardware or capture failure produces `CAMERA_ERROR`.
- Captured images are temporary. They are removed after processing unless the scan image is deliberately retained with the result (open decision).
- Capture resolution should be only as high as OMR accuracy requires, to limit memory use and processing time on low-end devices.

## Result Scoring Contract

Planned.

- **Input:** the reviewed answers for one sheet and the selected Answer Key.
- **Output:** per-question correctness, total score, and total possible points.
- Scoring uses the answers **after** Teacher review. A Teacher correction overrides the detected state.
- `SELECTED` is correct when it matches the key. `BLANK` and `MULTIPLE` score as incorrect. A result must not be finalized while any question is still `UNCERTAIN`.
- Scoring is a pure, deterministic function with no I/O, so it can be unit tested without a device.
- Saving writes the result, its answers, and its scan record in one transaction.
- Per-question points default to one; weighted questions are an open decision.

## Permanent Deletion Contract

Permanent physical deletion removes rows from the local SQLite database. It never sets a flag, never archives, and leaves no tombstone, soft-deleted record, or synchronization instruction.

### Implemented

| Deleting | Behavior |
| --- | --- |
| Subject | Blocked with `IN_USE` while Answer Keys belong to it. Otherwise the row and its `class_subjects` rows are removed |
| Class | Blocked with `IN_USE` while it has Students. Otherwise the row and its `class_subjects` rows are removed |
| Assignment | The `class_subjects` row is removed. Nothing else is affected |
| Student | Blocked with `IN_USE` while saved Results belong to it. Otherwise the row is removed. Results are never removed from here |
| Answer Key | Blocked with `IN_USE` while saved Results were scored with it. Otherwise the row and its `answer_key_items` rows are removed |

- The dependency check and the delete are one transaction.
- The record disappears from the list only after commit.
- The earlier open decision "block or cascade" is settled for every record above: **block**.
- Every deletion is confirmed in a dialog that names the record, says it is permanent, and offers Cancel first. For a Student it shows the name and Student ID; for an Answer Key, the name, Subject, and question count.

### Planned: `deleteResult(resultId)`

1. Verify the result exists. If not, return `NOT_FOUND` (callers may treat this as already deleted).
2. Read the associated local image path, if any.
3. Begin a local transaction.
4. Delete the result. Its answer rows and scan record are removed with it.
5. Commit the transaction.
6. Delete the associated local image file, if present.

A Result also removes its student answers, its scan record, and the local scan image.

A Student or an Answer Key with Results stays blocked. The Teacher deletes the Results first; no use case removes them on a parent's behalf.

**Local file cleanup**

- Image paths are collected before the transaction, and files are deleted after it commits, never before, so a rolled-back delete does not lose its image.
- If file deletion fails, the database delete still stands and `FILE_ERROR` is logged. A cleanup pass removes image files that no scan record references.

**Error handling**

- A failure inside the transaction rolls everything back and returns `DATABASE_ERROR`. The record remains fully intact.

**No recovery**

- There is no backup and no remote copy. A committed deletion cannot be undone.

## Error Model

| Code | Meaning | Status |
| --- | --- | --- |
| `VALIDATION_ERROR` | Input is missing or invalid. `InvalidNameError`, `InvalidStudentError`, and `InvalidAnswerKeyError` carry the list of problems, each with its field | Implemented |
| `DUPLICATE_NAME` | Another Subject or Class, or another Answer Key of the same Subject, has this name, ignoring letter case | Implemented |
| `DUPLICATE_STUDENT_ID` | Another Student has this Student ID, ignoring letter case | Implemented |
| `NOT_FOUND` | The requested record does not exist (`RecordNotFoundError`, `ClassNotFoundError`, `SubjectNotFoundError`) | Implemented |
| `IN_USE` | Deletion is blocked because other records depend on this one (`SubjectInUseError`, `ClassInUseError`, `StudentInUseError`, `AnswerKeyInUseError`, each with a count) | Implemented |
| `ANSWER_KEY_LOCKED` | The Answer Key has saved Results, so its Subject, question count, and answers cannot change (`AnswerKeyLockedError`, with the count) | Implemented |
| `ROSTER_FILE_ERROR` | The picked file cannot be used as a roster (`RosterFileError`, with the reason) | Implemented |
| `DATABASE_ERROR` | A SQLite operation failed (`DatabaseError`, `MigrationFailedError`, `UnsupportedSchemaVersionError`). The original failure is kept as the cause and is not shown to the Teacher | Implemented |
| `CAMERA_ERROR` | Camera unavailable or capture failed | Planned |
| `OMR_FAILED` | Sheet or alignment markers could not be detected or processed | Planned |
| `OMR_UNCERTAIN` | Processing succeeded but one or more questions need Teacher review. A review signal, not a failure | Planned |
| `FILE_ERROR` | A local scan image could not be read, written, or deleted | Planned |
| `PERMISSION_ERROR` | A required device permission was denied | Planned |

Errors are classes with a `code` field. Callers branch on the class or the code, never on the message. The presentation layer turns each error into Teacher-facing text; for example `IN_USE` on a Subject becomes "This subject has 2 answer keys. Delete those answer keys permanently first; then the subject can be deleted."

## Versioning

- **Database schema:** versioned migrations applied on app start; see [Database Contract](#database-contract). The current version is 4.
- **Answer sheet template (Planned):** each template carries a version so old printed sheets remain scannable after the layout changes. A future QR code may encode the template version.
- **This document:** updated only during an authorized documentation pass; `docs/` is otherwise frozen.
