# Diagrams

Last reviewed: 2026-10-02

Each diagram is marked **Implemented** or **Planned**. The application is offline-only: every component in every diagram runs on the Teacher's device, and there is no backend, cloud database, or synchronization. Status details are in [project.md](./project.md#current-implementation-status). Decisions are governed by [source-of-truth.md](./source-of-truth.md).

## Implemented Architecture

Implemented. This is what the code contains today.

```mermaid
flowchart TD
    subgraph Device["Teacher's device - no network used"]
        ROOT["src/app/_layout.tsx: composition root"]
        UI["Presentation: Home, Answer Keys, Students, Subjects, Classes, Settings, placeholders"]
        UC["Application: subject, class, class-subject, student, and answer key use cases"]
        DOMAIN["Domain: Subject, SchoolClass, Student, AnswerKey, roster and CSV rules"]
        REPO["Infrastructure: SQLite repositories"]
        FILES["Infrastructure: roster file picker"]
        CORE["Infrastructure: database provider, migrations, runInTransaction"]
        DB[("answer-checker.db - schema version 4")]
        CSV["CSV file chosen by the Teacher"]
    end

    ROOT --> UI
    ROOT --> REPO
    ROOT --> FILES
    UI --> UC
    UC --> DOMAIN
    REPO --> UC
    FILES --> UC
    REPO --> CORE
    CORE --> DB
    FILES --> CSV
```

## Target Architecture

Planned. Camera, OMR, and scan-image storage are not built.

```mermaid
flowchart TD
    subgraph Device["Teacher's device - no network used"]
        UI["Mobile presentation layer: React Native Reusables + NativeWind"]
        APP["Application use cases"]
        DOMAIN["Domain rules"]
        subgraph Infra["Local infrastructure"]
            CAM["Camera - planned"]
            OMR["On-device OMR, OpenCV - planned"]
            REPO["SQLite repositories"]
            FILES["Local file storage: scan images - planned"]
        end
        DB[("Local SQLite database")]
    end

    UI --> APP
    APP --> DOMAIN
    APP --> CAM
    APP --> OMR
    APP --> REPO
    APP --> FILES
    CAM --> OMR
    REPO --> DB
```

## Clean Architecture Layers

Implemented. Arrows show allowed import direction. Rules are in [source-of-truth.md](./source-of-truth.md#clean-architecture-layers).

```mermaid
flowchart TD
    ROUTES["src/app: routes and composition root"]
    PRES["Presentation: screens, components, hooks"]
    INFRA["Infrastructure, all local: SQLite, roster files, later camera and OpenCV"]
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
        SCAN["3 Scan - placeholder"]
        STUDENTS["4 Students"]
        RESULTS["5 Results - placeholder"]
    end

    HOME --> MORE["More list on Home"]
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
```

Planned nested screens that do not exist: scan selection, Camera, Review Detection, Result Detail.

## Implemented SQLite Schema

Implemented. This is the physical schema after migrations 1 to 4 (`PRAGMA user_version` = 4). All tables are `STRICT`. All `id` columns are device-generated UUIDs. There is no exam table: migration 4 converted `exams`, `exam_questions`, and the old per-question `answer_keys` into the tables below.

```mermaid
erDiagram
    SUBJECTS ||--o{ CLASS_SUBJECTS : "taught to"
    CLASSES ||--o{ CLASS_SUBJECTS : "takes"
    CLASSES ||--o{ STUDENTS : contains
    SUBJECTS ||--o{ ANSWER_KEYS : has
    ANSWER_KEYS ||--|{ ANSWER_KEY_ITEMS : "one per question"
    ANSWER_KEYS ||--o{ RESULTS : "scored with"
    STUDENTS ||--o{ RESULTS : receives
    RESULTS ||--o{ STUDENT_ANSWERS : contains
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
        integer score
        integer total
        text created_at
    }
    STUDENT_ANSWERS {
        text id PK
        text result_id FK
        integer question_number
        text state
        text selected_answer
        integer is_correct
        integer teacher_corrected
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
- An Answer Key has a Subject and no Class. The Class reaches a Result through the Student.
- `students.student_number` is the Student ID and is unique in the whole app, ignoring letter case. An Answer Key name is unique within its Subject. One result per student per answer key is enforced by a unique index.
- `question_count` and `question_number` are 1 to 40; `correct_answer` is A, B, C, or D.
- `scan_records.image_path` points to a file in local storage, or is null when no image was kept.
- `results`, `student_answers`, and `scan_records` hold no rows yet: nothing saves a result until scanning exists.
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

Implemented. The locked path is covered by tests; it cannot be reached on a phone until Results exist.

```mermaid
flowchart TD
    E["Save changes to an answer key"] --> V{"Name, subject, 1 to 40 questions, every answer A to D?"}
    V -- No --> X["VALIDATION_ERROR, nothing saved"]
    V -- Yes --> R{"Saved results scored with this key?"}
    R -- No --> W["Replace header and all items in one transaction"]
    R -- Yes --> S{"Subject, question count, or any answer changed?"}
    S -- No --> N["Save the new name only"]
    S -- Yes --> L["ANSWER_KEY_LOCKED, nothing saved"]
    L --> D["Duplicate the key and revise the copy"]
```

## Planned Scanning Sequence

Planned. The four selection reads exist; nothing from "Scan sheet" onward is built.

```mermaid
sequenceDiagram
    actor Teacher
    participant App as Mobile App
    participant DB as Local SQLite database
    participant OMR as On-device OMR
    participant Files as Local file storage

    Teacher->>App: Select Subject
    App->>DB: Answer Keys of the Subject
    App->>DB: Classes assigned to the Subject (class_subjects)
    Teacher->>App: Select Answer Key and Class
    App->>DB: Students whose class_id is the Class
    Teacher->>App: Select Student
    Teacher->>App: Scan sheet
    App->>Files: Store captured image
    App->>OMR: Captured image
    OMR-->>App: A to D answers with states
    Teacher->>App: Review blank, multiple, uncertain
    App->>App: Validate Subject, Key, Class, Student again
    App->>App: Score against the Answer Key
    App->>DB: Save result and answers in one transaction
    App-->>Teacher: Show result
    Note over App,Files: Every step runs on the device. Nothing is sent anywhere.
```

Selection rules:

```mermaid
flowchart TD
    S["Subject changed"] --> S1["Clear Answer Key, Class, and Student that no longer match"]
    C["Class changed"] --> C1["Clear Student that no longer matches"]
    SAVE["Save"] --> V{"Key belongs to Subject, Class assigned to Subject, Student in Class?"}
    V -- Yes --> OK["Write result"]
    V -- No --> ERR["VALIDATION_ERROR, nothing saved"]
```

## Planned OMR Flow

Planned.

```mermaid
flowchart TD
    B["Camera"] --> C{"Sheet and markers detected?"}
    C -- No --> B
    C -- Yes --> D["Perspective Correction"]
    D --> E["Grayscale and Thresholding"]
    E --> F["Detect A to D Bubbles"]
    F --> G["Interpret Answers per Question"]
    G --> H{"Question state"}
    H -- SELECTED --> I["Accept detected answer"]
    H -- BLANK --> J["Flag: no answer"]
    H -- MULTIPLE --> K["Flag: more than one bubble"]
    H -- UNCERTAIN --> L["Flag: low confidence"]
    I --> M["Validation"]
    J --> M
    K --> M
    L --> M
    M --> N["Teacher Review"]
    N --> O{"Flags resolved and confirmed?"}
    O -- "Edit answers" --> N
    O -- Rescan --> B
    O -- Confirm --> P["Score against the Answer Key"]
    P --> Q["Save to SQLite"]
    Q --> R["View Result"]
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
| Class | Students of the class |
| Student | Results of the student |
| Answer Key | Results scored with the key |

## Permanent Deletion: Result

Planned.

```mermaid
flowchart TD
    A["Teacher taps Delete Permanently"] --> B{"Confirmation dialog"}
    B -- Cancel --> Z["No change"]
    B -- "Delete Permanently" --> P["Read local image path"]
    P --> C["Begin SQLite transaction"]
    C --> E["Delete result: answers and scan record go with it"]
    E --> F{"Transaction commits?"}
    F -- No --> R["Roll back: record fully intact, show error"]
    F -- Yes --> G["Delete local scan image file"]
    G --> H["Record disappears from UI"]
    H --> I["Nothing remains: no tombstone, no soft-deleted row"]
```
