# Diagrams

Last reviewed: 2026-10-02

Each diagram is marked **Implemented** or **Planned**. The application is offline-only: every component in every diagram runs on the Teacher's device, and there is no backend, cloud database, or synchronization. Status details are in [project.md](./project.md#current-implementation-status). Decisions are governed by [source-of-truth.md](./source-of-truth.md).

## Implemented Architecture

Implemented. This is what the code contains today.

```mermaid
flowchart TD
    subgraph Device["Teacher's device - no network used"]
        ROOT["src/app/_layout.tsx: composition root"]
        UI["Presentation: Home, Answer Keys, Scan, Students, Results, Subjects, Classes, Settings"]
        CAM["Presentation: camera capture, expo-camera"]
        UC["Application: subject, class, class-subject, student, answer key, scan, results, dashboard, and demo-data use cases"]
        DOMAIN["Domain: Subject, SchoolClass, Student, AnswerKey, roster and CSV rules, sheet template and PDF, detection, scoring"]
        REPO["Infrastructure: SQLite repositories and the dashboard read model"]
        FILES["Infrastructure: roster file picker"]
        OMR["Infrastructure: sheet reader in TypeScript, PNG codec"]
        IMAGES["Infrastructure: scan image store, result image store, printable sheet sharing"]
        CORE["Infrastructure: database provider, migrations, runInTransaction"]
        DB[("answer-checker.db - schema version 7")]
        CSV["CSV file chosen by the Teacher"]
        STORE["App-private files: cache, documents/scans, documents/scans-deleting"]
    end

    ROOT --> UI
    ROOT --> REPO
    ROOT --> FILES
    ROOT --> OMR
    ROOT --> IMAGES
    UI --> CAM
    UI --> UC
    UC --> DOMAIN
    REPO --> UC
    FILES --> UC
    OMR --> UC
    IMAGES --> UC
    REPO --> CORE
    CORE --> DB
    FILES --> CSV
    IMAGES --> STORE
```

## Target Architecture

The implemented architecture above is the target architecture: every layer and every local component it names exists.

## Clean Architecture Layers

Implemented. Arrows show allowed import direction. Rules are in [source-of-truth.md](./source-of-truth.md#clean-architecture-layers).

```mermaid
flowchart TD
    ROUTES["src/app: routes and composition root"]
    PRES["Presentation: screens, components, hooks"]
    INFRA["Infrastructure, all local: SQLite, roster files, sheet reader, scan images"]
    APP["Application: use cases and ports"]
    DOMAIN["Domain: entities and pure rules"]

    ROUTES --> PRES
    ROUTES --> INFRA
    PRES --> APP
    PRES --> DOMAIN
    INFRA --> APP
    INFRA --> DOMAIN
    APP --> DOMAIN
```

## Mobile Navigation

Implemented and verified on a physical Android phone. The bottom bar has exactly five items. Classes, Subjects, and Settings open from the More list on Home and are not in the bar; while one is open, Home stays selected. There is no Exams tab.

```mermaid
flowchart TD
    subgraph Bar["Bottom navigation - five items"]
        HOME["1 Home"]
        KEYS["2 Keys - Answer Keys"]
        SCAN["3 Scan"]
        STUDENTS["4 Students"]
        RESULTS["5 Results"]
    end

    HOME --> MORE["More list on Home"]
    HOME -- "Scan answer sheet, Continue scanning" --> SCAN
    HOME -- "Create answer key, recent answer key, Answer Keys count" --> KEYS
    HOME -- "Add student, Students count" --> STUDENTS
    HOME -- "View results, recent result, Results count" --> RESULTS
    HOME -- "Classes count" --> CLASSES
    HOME -- "Header button" --> SETTINGS
    MORE --> CLASSES["Classes"]
    MORE --> SUBJECTS["Subjects"]
    MORE --> SETTINGS["Settings"]
    CLASSES --> MANAGE["Manage subjects dialog"]
    CLASSES -- "Back" --> HOME
    SUBJECTS -- "Back" --> HOME
    SETTINGS -- "Back" --> HOME

    KEYS --> KEYFORM["Answer key form: create, edit, duplicate"]
    KEYS --> KEYVIEW["Answer key view"]
    KEYS -- "Open Subjects, only while no subject exists" --> SUBJECTS
    STUDENTS --> STUDENTFORM["Student form: add, edit, move"]
    STUDENTS --> IMPORT["Roster import preview"]
    SCAN --> PICK["Picker sheets: subject, answer key, class, student"]
    SCAN --> SHARE["System share sheet: printable answer sheet PDF"]
    SCAN --> CAMERA["Camera"]
    CAMERA --> REVIEW["Review of the reading"]
    REVIEW --> SAVED["Result saved: scan next student"]
    PICK -- "Create answer key, only while the subject has none" --> KEYS
    PICK -- "Add students, only while the class has none" --> STUDENTS
    RESULTS --> RFILTER["Filter sheets: subject, answer key, class, student"]
    RESULTS --> RDETAIL["Result details"]
    RDETAIL --> RIMAGE["Stored scan viewer"]
    RDETAIL --> RDELETE["Delete permanently: confirmation"]
    RESULTS -- "Scan an answer sheet, only while no result exists" --> SCAN
    SETTINGS --> DEMO["Demo data: add or remove, development builds only"]
```

The pickers, the camera, the review, the Result details, and the scan viewer are sheets and full-screen dialogs over their screen, not routes.

## Implemented SQLite Schema

Implemented. This is the physical schema after migrations 1 to 7 (`PRAGMA user_version` = 7). All tables are `STRICT`. All `id` columns are device-generated UUIDs. There is no exam table: migration 4 converted `exams`, `exam_questions`, and the old per-question `answer_keys` into the tables below.

```mermaid
erDiagram
    SUBJECTS ||--o{ CLASS_SUBJECTS : "taught to"
    CLASSES ||--o{ CLASS_SUBJECTS : "takes"
    CLASSES ||--o{ STUDENTS : contains
    SUBJECTS ||--o{ ANSWER_KEYS : has
    ANSWER_KEYS ||--|{ ANSWER_KEY_ITEMS : "one per question"
    ANSWER_KEYS ||--o{ RESULTS : "scored with"
    STUDENTS ||--o{ RESULTS : receives
    CLASSES ||--o{ RESULTS : "scanned under"
    RESULTS ||--|{ STUDENT_ANSWERS : contains
    RESULTS ||--o| SCAN_RECORDS : "scanned from"

    SUBJECTS {
        text id PK
        text name UK
        text created_at
        text updated_at
    }
    CLASSES {
        text id PK
        text name UK
        text created_at
        text updated_at
    }
    CLASS_SUBJECTS {
        text class_id PK, FK
        text subject_id PK, FK
        text created_at
    }
    STUDENTS {
        text id PK
        text class_id FK
        text student_number UK
        text full_name
        text created_at
        text updated_at
    }
    ANSWER_KEYS {
        text id PK
        text subject_id FK
        text name
        integer question_count
        text created_at
        text updated_at
    }
    ANSWER_KEY_ITEMS {
        text answer_key_id PK, FK
        integer question_number PK
        text correct_answer
    }
    RESULTS {
        text id PK
        text answer_key_id FK
        text student_id FK
        text class_id FK
        integer score
        integer total
        text template_id
        text captured_at
        text created_at
        text student_name
        text student_number
        text class_name
        text subject_name
        text answer_key_name
    }
    STUDENT_ANSWERS {
        text id PK
        text result_id FK
        integer question_number
        text detected_state
        text detected_answer
        text final_answer
        text correct_answer
        integer is_correct
        integer manually_corrected
        real confidence
    }
    SCAN_RECORDS {
        text id PK
        text result_id FK
        text image_path
        text scanned_at
    }
```

Notes:

- Delete rules: `class_subjects`, `answer_key_items`, `student_answers`, and `scan_records` are removed with their parent (CASCADE). Every other foreign key is RESTRICT. The full table is in [api.md](./api.md#foreign-keys-and-delete-rules).
- An Answer Key has a Subject and no Class. A Result records the Class the Student was in when the sheet was scanned (`results.class_id`, RESTRICT), so it stays under that Class if the Student moves later.
- `students.student_number` is the Student ID and is unique in the whole app, ignoring letter case. An Answer Key name is unique within its Subject.
- A Student may have several Results with one Answer Key: each scan is a separate attempt. The index on `(answer_key_id, student_id)` is not unique.
- `question_count` and `question_number` are 1 or more, with no upper limit in the database; `correct_answer` is A, B, C, or D.
- `student_answers.detected_state` is `MARKED`, `BLANK`, `MULTIPLE`, or `UNCLEAR`. `detected_answer` is what the reader read, `final_answer` what was scored after the Teacher's review (null is a blank), and `correct_answer` the key's letter at the time of scoring. `is_correct` must agree with the last two.
- `results.template_id` names the sheet that was read, for example `AC-10-V2`. `captured_at` is when the photo was taken, `created_at` when the Result was saved.
- `scan_records.image_path` is the path of the Result's one image, relative to the app's documents folder, for example `scans/<result id>.png`.
- `results.student_name`, `student_number`, `class_name`, `subject_name`, and `answer_key_name` are the names the Result was saved under. They are what a Result displays; the ID columns are what the filters and the delete rules use.
- The Results list is read through the index on `(captured_at, created_at, id)`.
- `results`, `student_answers`, and `scan_records` are written by Scan and read and deleted by Results. A saved row is never updated.
- There is no teacher, account, role, or synchronization table, and no soft-delete or archive column.

## Roster Import

Implemented and verified on a physical Android phone.

```mermaid
sequenceDiagram
    actor Teacher
    participant UI as Students screen
    participant UC as Student use cases
    participant Files as Roster file picker
    participant DB as SQLite

    Teacher->>UI: Import CSV
    UI->>UC: pickRoster()
    UC->>Files: Delete stale copies in the app cache
    UC->>Files: Pick a file
    Files-->>UC: App-owned temporary copy
    UC->>Files: Read the text
    UC->>DB: Stored Student IDs and Classes
    UC->>Files: Delete the temporary copy (always)
    UC-->>UI: Draft: valid, invalid, repeated, already stored, groups
    UI-->>Teacher: Preview and class mapping
    alt Teacher cancels
        UI-->>Teacher: Nothing stored, nothing left to clean up
    else Teacher confirms
        UI->>UC: importStudents(rows)
        UC->>DB: One transaction: check classes and IDs, insert all
        UI-->>Teacher: Notice "12 students imported"
    end
    Note over Files: The original file is never deleted, changed, or moved.
```

## Answer Key Editing Rule

Implemented. The locked path is covered by tests and is reachable on the phone now that Scan saves Results.

```mermaid
flowchart TD
    E["Save changes to an answer key"] --> V{"Name, subject, 1 to 200 questions, every answer A to D?"}
    V -- No --> X["VALIDATION_ERROR, nothing saved"]
    V -- Yes --> R{"Saved results scored with this key?"}
    R -- No --> W["Replace header and all items in one transaction"]
    R -- Yes --> S{"Subject, question count, or any answer changed?"}
    S -- No --> N["Save the new name only"]
    S -- Yes --> L["ANSWER_KEY_LOCKED, nothing saved"]
    L --> D["Duplicate the key and revise the copy"]
```

## Scanning Sequence

Implemented and verified on a physical Android phone.

```mermaid
sequenceDiagram
    actor Teacher
    participant UI as Scan screen
    participant UC as Scan use cases
    participant DB as Local SQLite database
    participant OMR as Sheet reader
    participant Files as Scan image store

    Teacher->>UI: Select Subject
    UI->>UC: listOptions(selection)
    UC->>DB: Answer Keys of the Subject, Classes assigned to it
    Teacher->>UI: Select Answer Key and Class
    UC->>DB: Students of the Class, with how often each was scanned with the key
    Teacher->>UI: Select Student
    Teacher->>UI: Open camera, take the photo
    UI->>UC: readCapture(photo, selection)
    UC->>DB: Validate Subject, Key, Class, Student
    UC->>Files: Load the photo as grayscale at working size
    UC->>OMR: Photo and the template for the key's question count
    alt Photo cannot be trusted
        OMR-->>UC: Refused with a reason
        UC->>Files: Delete the photo
        UI-->>Teacher: What to change, Retake
    else Read
        OMR-->>UC: One decision per question, flattened sheet
        UC->>Files: Write the flattened sheet as a preview, delete the photo
        UI-->>Teacher: Review: sheet picture, answers, score so far
    end
    Teacher->>UI: Decide blank, multiple, unclear; correct if needed; Save
    UI->>UC: saveResult(draft, review)
    UC->>DB: Validate the selection again; key unchanged?
    UC->>DB: Earlier Results of this Student with this key?
    opt Earlier Result exists and not yet confirmed
        UI-->>Teacher: Confirm a second, separate attempt
    end
    UC->>Files: Move the preview to documents/scans/<result id>.png
    UC->>DB: One transaction: result, answers, scan record
    opt Transaction fails
        UC->>Files: Delete the moved image
    end
    UI-->>Teacher: Score, Scan next student
    Note over UI,Files: Every step runs on the device. Nothing is sent anywhere.
```

Selection rules:

```mermaid
flowchart TD
    S["Subject changed"] --> S1["Clear Answer Key; clear Class and Student unless the Class also takes the new Subject"]
    C["Class changed"] --> C1["Clear Student"]
    SAVE["Save"] --> V{"Key belongs to Subject, Class assigned to Subject, Student in Class, key fits one sheet?"}
    V -- No --> ERR["VALIDATION_ERROR, nothing saved"]
    V -- Yes --> K{"Answer key unchanged since the sheet was read?"}
    K -- No --> STALE["ANSWER_KEY_CHANGED, nothing saved, scan again"]
    K -- Yes --> R{"Every question decided?"}
    R -- No --> REV["VALIDATION_ERROR, back to review"]
    R -- Yes --> OK["Write result"]
```

## Answer Sheet Generation

Implemented. One template serves the printed sheet and the reader.

```mermaid
flowchart TD
    KEY["Selected Answer Key: N questions"] --> FIT{"N from 1 to 100?"}
    FIT -- No --> NONE["No sheet; the key cannot be scanned"]
    FIT -- Yes --> T["sheetTemplate(N): markers, orientation square, identity row spelling N, N rows of A to D"]
    T --> PDF["buildAnswerSheetPdf: one A4 page, questions 1 to N only"]
    PDF --> SHAREIT["System share sheet: view, print, send"]
    T --> READER["Reader: expects a sheet for N questions"]
    SHAREIT -. "printed, filled in, photographed" .-> READER
```

## OMR Flow

Implemented.

```mermaid
flowchart TD
    B["Photo"] --> S{"Enough pixels?"}
    S -- No --> X["Refused: retake"]
    S -- Yes --> C{"Four corner markers found, sheet large and square enough?"}
    C -- No --> X
    C -- Yes --> O{"Orientation square and a valid identity row in one of four turns?"}
    O -- No --> X
    O -- Yes --> W{"Sheet's question count equals the answer key's?"}
    W -- No --> X2["Refused: sheet for another answer key, both counts named"]
    W -- Yes --> D["Flatten the sheet to 4 pixels per millimetre"]
    D --> L{"Light and focus good enough?"}
    L -- No --> X
    L -- Yes --> F["Measure the fill of each bubble at its template position"]
    F --> H{"Question state"}
    H -- MARKED --> I["Accept the letter"]
    H -- BLANK --> J["Needs review: no answer"]
    H -- MULTIPLE --> K["Needs review: more than one bubble"]
    H -- UNCLEAR --> U["Needs review: no clear mark"]
    I --> N["Teacher review"]
    J --> N
    K --> N
    U --> N
    N --> Q{"Every question decided?"}
    Q -- "Choose a letter or Blank" --> N
    Q -- Retake --> B
    Q -- Save --> P["Score against the Answer Key"]
    P --> R["Save to SQLite with one image"]
```

## Permanent Deletion: Blocked or Deleted

Implemented for Subjects, Classes, Students, and Answer Keys. The diagram shows an Answer Key; the others differ only in what is counted.

```mermaid
sequenceDiagram
    actor Teacher
    participant UI as Screen and dialog
    participant UC as Use case
    participant Repo as SQLite repository
    participant DB as SQLite

    Teacher->>UI: Tap Delete on a row
    UI-->>Teacher: Confirm: name, subject, permanent, Cancel first
    Teacher->>UI: Delete
    UI->>UC: deleteAnswerKey(id)
    UC->>Repo: delete(id)
    Repo->>DB: BEGIN IMMEDIATE
    Repo->>DB: Record exists?
    Repo->>DB: Count results scored with the key
    alt Results exist
        Repo->>DB: ROLLBACK
        Repo-->>UI: IN_USE with the count
        UI-->>Teacher: Dialog explains why it is blocked
    else None
        Repo->>DB: DELETE row (answer_key_items rows cascade)
        Repo->>DB: COMMIT
        UI-->>Teacher: Notice "Answer key deleted permanently"
    end
```

| Deleting | Counted before deleting |
| --- | --- |
| Subject | Answer Keys of the subject |
| Class | Students of the class, and Results scanned under it |
| Student | Results of the student |
| Answer Key | Results scored with the key |

## Home Dashboard

Implemented and verified on a physical Android phone.

```mermaid
sequenceDiagram
    actor Teacher
    participant UI as Home screen
    participant UC as Dashboard use case
    participant DB as Local SQLite database
    participant Next as Target screen

    Teacher->>UI: Open Home, or return to it
    UI->>UC: getDashboard()
    UC->>DB: Counts, with the local day as two UTC instants
    UC->>DB: Three newest results
    UC->>DB: Three most recently changed answer keys
    UC->>DB: What the newest result was scanned with
    UC-->>UI: Each part, or null where it could not be read
    UI-->>Teacher: Counts, Scanned today, recent lists, Continue scanning
    Teacher->>UI: Tap a recent result, a create action, or Continue scanning
    UI->>Next: Leave a one-time intent, then navigate
    Next->>Next: Take the intent once its data is loaded
    Next-->>Teacher: The result, the form, or the scan session, already open
    Note over UI,DB: Read again on every visit, never on a timer. Only the newest reading is kept.
```

## Results Browsing

Implemented and verified on a physical Android phone.

```mermaid
sequenceDiagram
    actor Teacher
    participant UI as Results screen
    participant UC as Results use cases
    participant DB as Local SQLite database
    participant Files as Result image store

    Teacher->>UI: Open Results
    UI->>UC: settleInterruptedDeletions()
    UI->>UC: listResults, countResults, listFilterLinks
    UC->>DB: One page newest first, the counts, the filter combinations
    UI-->>Teacher: Rows: student, class, answer key, subject, score, date, attempt
    Teacher->>UI: Type in search, or choose a filter
    UI->>UC: listResults with the filter and the search
    Teacher->>UI: Scroll to the end
    UI->>UC: listResults after the last row
    Teacher->>UI: Open a row
    UI->>UC: getResult(id)
    UC->>DB: Result, answers in question order, image path
    UC->>Files: Is the image a scan image, and is it there?
    UI-->>Teacher: Details, read-only; the scan, or "Stored scan image is unavailable"
    Note over UI,Files: No image is loaded for the list. Nothing can be edited.
```

## Permanent Deletion: Result

Implemented and verified on a physical Android phone.

```mermaid
flowchart TD
    A["Teacher taps Delete permanently"] --> B{"Confirmation: student, answer key, date, score, attempt"}
    B -- Cancel --> Z["No change"]
    B -- Delete --> P["Read the result and its image path"]
    P --> S{"Path is scans/name.png and the file exists?"}
    S -- No --> C["Begin SQLite transaction"]
    S -- Yes --> M{"Move the image to scans-deleting"}
    M -- Fails --> X["FILE_ERROR: nothing changed"]
    M -- Moved --> C
    C --> E["Delete answers, scan record, result"]
    E --> F{"Transaction commits?"}
    F -- No --> R["Roll back, move the image back: result fully intact, show error"]
    F -- Yes --> G["Delete the staged image"]
    G --> H["Result disappears from the list, notice shown"]
    H --> I["Nothing remains: no tombstone, no soft-deleted row, no hidden copy"]
    G -. "deletion of the file fails" .-> L["Leftover removed the next time Results is opened"]
```
