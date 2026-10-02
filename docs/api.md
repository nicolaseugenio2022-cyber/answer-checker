# Application API

Last reviewed: 2026-10-02

This document describes the application's internal contracts: the boundaries between UI, application use cases, OMR, camera, and local storage. The application is offline-only, so every contract here is an in-process contract on the device. There are no network routes; see [api-routes.md](./api-routes.md).

> **Status.** Implemented: the [Database Contract](#database-contract), the [Subjects and Classes Contract](#subjects-and-classes-contract), the [Subject-to-Class Assignment Contract](#subject-to-class-assignment-contract), and the implemented part of the [Error Model](#error-model). Everything else is a **Planned Contract**: no Student, Answer Key, OMR, camera, scoring, or result code exists, and its names and shapes may change when built.

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
| Subject-to-Class assignments | `listSubjectsForClass(classId)`, `listClassesForSubject(subjectId)`, `isSubjectAssignedToClass(classId, subjectId)`, `assignSubjectToClass(classId, subjectId)`, `removeSubjectFromClass(classId, subjectId)`, `replaceSubjectsForClass(classId, subjectIds)`, `countSubjectsByClass()`, `countClassesBySubject()` | Implemented, not verified on a device |
| Students | add one, add several, import CSV, rename, move, delete | Planned |
| Answer Keys | create, edit, delete, list by Subject | Planned |
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

| Version | File | Adds | Device status |
| --- | --- | --- | --- |
| 1 | `0001-initial-schema.ts` | `subjects`, `classes`, `students`, `exams`, `exam_questions`, `answer_keys`, `exam_results`, `student_answers`, `scan_records` | Verified on an Android 14 emulator and a physical phone |
| 2 | `0002-class-subjects.ts` | `class_subjects` | Not verified on a device. Node tests cover a fresh install and an upgrade from version 1 |

### Schema conventions

- Every table is `STRICT`.
- Primary keys are `TEXT` UUIDs named `id`, except `class_subjects`, whose primary key is `(class_id, subject_id)`.
- Timestamps are `TEXT`, checked against the UTC ISO-8601 form `YYYY-MM-DDTHH:MM:SS.sssZ`.
- Booleans are `INTEGER` 0 or 1.
- Subject and class names are `COLLATE NOCASE` with a `UNIQUE` constraint.
- Answer letters are restricted to `A`, `B`, `C`, `D`; `choice_count` is between 2 and 4.
- No table has a soft-delete, archive, tombstone, or synchronization column.

### Indexes

| Index | Table and columns |
| --- | --- |
| `idx_students_class_id_full_name` | `students (class_id, full_name)` |
| `idx_exams_subject_id` | `exams (subject_id)` |
| `idx_exams_class_id` | `exams (class_id)` |
| `idx_exams_created_at` | `exams (created_at)` |
| `idx_exam_results_exam_id_student_id` (unique) | `exam_results (exam_id, student_id)` |
| `idx_exam_results_student_id` | `exam_results (student_id)` |
| `idx_exam_results_created_at` | `exam_results (created_at)` |
| `idx_class_subjects_subject_id` | `class_subjects (subject_id)` |

### Foreign keys and delete rules

| Child column | Parent | On delete |
| --- | --- | --- |
| `students.class_id` | `classes.id` | RESTRICT |
| `exams.subject_id` | `subjects.id` | RESTRICT |
| `exams.class_id` | `classes.id` | RESTRICT |
| `exam_results.exam_id` | `exams.id` | RESTRICT |
| `exam_results.student_id` | `students.id` | RESTRICT |
| `exam_questions.exam_id` | `exams.id` | CASCADE |
| `answer_keys.exam_question_id` | `exam_questions.id` | CASCADE |
| `student_answers.result_id` | `exam_results.id` | CASCADE |
| `scan_records.result_id` | `exam_results.id` | CASCADE |
| `class_subjects.class_id` | `classes.id` | CASCADE |
| `class_subjects.subject_id` | `subjects.id` | CASCADE |

### Transactions

- `runInTransaction(db, task)` runs a task in one `BEGIN IMMEDIATE` transaction on the initialized connection: everything commits together or nothing does. Calls on the same connection run one after another.
- Data writes must use it. `expo-sqlite`'s `withExclusiveTransactionAsync` opens a second connection on which foreign keys are off, so `RESTRICT` and `CASCADE` would not apply there. Only the migration runner uses that method.
- If the task throws, the transaction rolls back and the task's error is rethrown.

## Repository Rules

Implemented for Subjects, Classes, and assignments; binding for every later repository.

- Repositories are the only code that issues SQL. They use raw `expo-sqlite` through a small `SqlConnection` type, so the same code runs against Node's SQLite in tests. Drizzle ORM is undecided and not installed.
- Values are passed as parameters. Nothing supplied by the Teacher is placed in SQL text.
- Multi-step writes and deletion checks run inside `runInTransaction`.
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

- A Subject used by exam rows is not deleted. The error carries `examCount`.
- A Class with students or exam rows is not deleted. The error carries `studentCount` and `examCount`.
- The check and the delete run in the same transaction. Nothing is deleted automatically except the record's own `class_subjects` rows.

Repository operations behind these use cases: `list`, `getById`, `create`, `rename`, `delete`.

## Subject-to-Class Assignment Contract

Implemented, not verified on a physical device.

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
- Removing assignments never deletes a Subject, Class, Student, or exam row.
- The only editing workflow is Classes → Manage subjects, which calls `replaceSubjectsForClass`.

## Student Contract

Planned (Stage 3). Nothing is implemented.

- A Student has an internal ID, a Student ID shown to the Teacher, a full name, and a `class_id`. The existing `students` table stores the Student ID in `student_number`, unique within a class.
- A Student belongs to exactly one Class and has no Course, Grade, Strand, or Section field.
- Entry methods: add one, add several, and import a CSV file read from local storage.
- CSV inside a selected Class has the columns `student_id,full_name`. An optional multi-Class CSV adds a `class` column holding the Class name.
- Import must be atomic per file and must report rejected rows; the exact rules are decided in Stage 3.

## Answer Key Contract

Planned (Stage 4). Nothing is implemented.

- An Answer Key has a name, a Subject, a number of questions, and one correct letter (A–D) per question.
- It stores no question text, choice text, or exam content.
- A Subject can have several Answer Keys, and an Answer Key can be used with several Classes.
- The current schema cannot express this: `exams.class_id` is required. A schema and terminology migration comes first; see [source-of-truth.md](./source-of-truth.md#answer-key-truth).

## Scan Selection Contract

Planned (Stage 5).

1. `listSubjects()`
2. Answer Keys of the chosen Subject
3. `listClassesForSubject(subjectId)`
4. Students whose `class_id` is the chosen Class
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
| Subject | Blocked with `IN_USE` while exam rows use it. Otherwise the row and its `class_subjects` rows are removed |
| Class | Blocked with `IN_USE` while it has students or exam rows. Otherwise the row and its `class_subjects` rows are removed |
| Assignment | The `class_subjects` row is removed. Nothing else is affected |

- The dependency check and the delete are one transaction.
- The record disappears from the list only after commit.
- The earlier open decision "block or cascade" for Subjects and Classes is settled: **block**.
- Every deletion is confirmed in a dialog that names the record, says it is permanent, and offers Cancel first.

### Planned: `deleteResult(resultId)`

1. Verify the result exists. If not, return `NOT_FOUND` (callers may treat this as already deleted).
2. Read the associated local image path, if any.
3. Begin a local transaction.
4. Delete the result. Its answer rows and scan record are removed with it.
5. Commit the transaction.
6. Delete the associated local image file, if present.

Planned rules for other records:

| Deleting | Rule |
| --- | --- |
| Result | Also removes student answers, scan record, and the local scan image |
| Answer Key (exam row) | Removes its questions and answer letters. Blocked while results exist unless the use case removes those results deliberately in the same transaction, after collecting their image paths |
| Student | Blocked while results exist, under the same condition |

A use case that removes results on behalf of a parent must say so in the confirmation dialog.

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
| `VALIDATION_ERROR` | Input is missing or invalid. `InvalidNameError` carries the problem (`EMPTY` or `TOO_LONG`) and the maximum length | Implemented |
| `DUPLICATE_NAME` | Another record of the same kind has this name, ignoring letter case | Implemented |
| `NOT_FOUND` | The requested record does not exist (`RecordNotFoundError`, `ClassNotFoundError`, `SubjectNotFoundError`) | Implemented |
| `IN_USE` | Deletion is blocked because other records depend on this one (`SubjectInUseError`, `ClassInUseError`, with counts) | Implemented |
| `DATABASE_ERROR` | A SQLite operation failed (`DatabaseError`, `MigrationFailedError`, `UnsupportedSchemaVersionError`). The original failure is kept as the cause and is not shown to the Teacher | Implemented |
| `CAMERA_ERROR` | Camera unavailable or capture failed | Planned |
| `OMR_FAILED` | Sheet or alignment markers could not be detected or processed | Planned |
| `OMR_UNCERTAIN` | Processing succeeded but one or more questions need Teacher review. A review signal, not a failure | Planned |
| `FILE_ERROR` | A local file could not be read, written, or deleted | Planned |
| `PERMISSION_ERROR` | A required device permission was denied | Planned |

Errors are classes with a `code` field. Callers branch on the class or the code, never on the message. The presentation layer turns each error into Teacher-facing text; for example `IN_USE` on a class becomes "This class contains 24 students and is used by 2 exams."

## Versioning

- **Database schema:** versioned migrations applied on app start; see [Database Contract](#database-contract). The current version is 2.
- **Answer sheet template (Planned):** each template carries a version so old printed sheets remain scannable after the layout changes. A future QR code may encode the template version.
- **This document:** updated only during an authorized documentation pass; `docs/` is otherwise frozen.
