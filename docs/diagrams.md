# Diagrams

Last reviewed: 2026-10-02

Each diagram is marked **Implemented** or **Planned**. The application is offline-only: every component in every diagram runs on the Teacher's device, and there is no backend, cloud database, or synchronization. Status details are in [project.md](./project.md#current-implementation-status). Decisions are governed by [source-of-truth.md](./source-of-truth.md).

## Implemented Architecture

Implemented. This is what the code contains today.

```mermaid
flowchart TD
    subgraph Device["Teacher's device - no network used"]
        ROOT["src/app/_layout.tsx: composition root"]
        UI["Presentation: Home, Subjects, Classes, Manage subjects dialog, Settings, placeholders"]
        UC["Application: subject, class, and class-subject use cases"]
        DOMAIN["Domain: Subject, SchoolClass, name rules"]
        REPO["Infrastructure: SQLite repositories"]
        CORE["Infrastructure: database provider, migrations, runInTransaction"]
        DB[("answer-checker.db - schema version 2")]
    end

    ROOT --> UI
    ROOT --> REPO
    UI --> UC
    UC --> DOMAIN
    REPO --> UC
    REPO --> CORE
    CORE --> DB
```

## Target Architecture

Planned. Camera, OMR, and file storage are not built.

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
    INFRA["Infrastructure, all local: SQLite, later files, camera, OpenCV"]
    APP["Application: use cases and repository contracts"]
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

Implemented and verified on a physical Android phone. The bottom bar has exactly five items. Classes, Subjects, and Settings open from the More list on Home and are not in the bar; while one is open, Home stays selected.

"Exams" is the temporary label of a placeholder. Its approved future label is "Keys" (Answer Keys).

```mermaid
flowchart TD
    subgraph Bar["Bottom navigation - five items"]
        HOME["1 Home"]
        EXAMS["2 Exams - placeholder, will become Keys"]
        SCAN["3 Scan - placeholder"]
        STUDENTS["4 Students - placeholder"]
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
```

Planned nested screens that do not exist: Answer Key editor, Student roster and import, scan selection, Camera, Review Detection, Result Detail.

## Implemented SQLite Schema

Implemented. This is the physical schema after migrations 1 and 2 (`PRAGMA user_version` = 2). All tables are `STRICT`. All `id` columns are device-generated UUIDs. Only `subjects`, `classes`, and `class_subjects` are used by the app today.

`exams`, `exam_questions`, and `answer_keys` are the names in the database. They predate the Answer Key decision and are shown as they are; see [Planned Answer Key Model](#planned-answer-key-model).

```mermaid
erDiagram
    SUBJECTS ||--o{ CLASS_SUBJECTS : "taught to"
    CLASSES ||--o{ CLASS_SUBJECTS : "takes"
    CLASSES ||--o{ STUDENTS : contains
    CLASSES ||--o{ EXAMS : "restricts delete"
    SUBJECTS ||--o{ EXAMS : "restricts delete"
    EXAMS ||--o{ EXAM_QUESTIONS : has
    EXAM_QUESTIONS ||--o| ANSWER_KEYS : "correct answer"
    EXAMS ||--o{ EXAM_RESULTS : produces
    STUDENTS ||--o{ EXAM_RESULTS : receives
    EXAM_RESULTS ||--o{ STUDENT_ANSWERS : contains
    EXAM_RESULTS ||--o| SCAN_RECORDS : "scanned from"

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
        text student_number
        text full_name
        text created_at
        text updated_at
    }
    EXAMS {
        text id PK
        text subject_id FK
        text class_id FK
        text title
        integer question_count
        text created_at
        text updated_at
    }
    EXAM_QUESTIONS {
        text id PK
        text exam_id FK
        integer question_number
        integer choice_count
        integer points
    }
    ANSWER_KEYS {
        text id PK
        text exam_question_id FK
        text correct_answer
    }
    EXAM_RESULTS {
        text id PK
        text exam_id FK
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

- Delete rules: `class_subjects`, `exam_questions`, `answer_keys`, `student_answers`, and `scan_records` are removed with their parent (CASCADE). Every other foreign key is RESTRICT. The full table is in [api.md](./api.md#foreign-keys-and-delete-rules).
- `students.student_number` is unique within a class. One result per student per exam row is enforced by a unique index.
- `scan_records.image_path` points to a file in local storage, or is null when no image was kept.
- There is no teacher, account, role, or synchronization table, and no soft-delete or archive column.

## Planned Answer Key Model

Planned. This is the approved product model, not the current schema. It requires a migration that does not exist yet.

```mermaid
erDiagram
    SUBJECT ||--o{ ANSWER_KEY : has
    ANSWER_KEY ||--|{ KEY_ANSWER : "one per question"
    SUBJECT ||--o{ CLASS_SUBJECT : "taught to"
    CLASS ||--o{ CLASS_SUBJECT : takes
    CLASS ||--o{ STUDENT : contains
    ANSWER_KEY ||--o{ RESULT : "scored with"
    STUDENT ||--o{ RESULT : receives

    ANSWER_KEY {
        text id PK
        text subject_id FK
        text name
        integer question_count
    }
    KEY_ANSWER {
        integer question_number
        text correct_answer "A, B, C, or D"
    }
```

Differences from the implemented schema:

- An Answer Key belongs to a Subject only. Today `exams.class_id` is required.
- An Answer Key is reused across Classes; the Class is chosen at scan time and reaches the Result through the Student.
- No question text, choice text, or exam content is stored.
- Table and column names for this model are not decided.

## Planned Scanning Sequence

Planned. Nothing here is built except `listSubjects` and `listClassesForSubject`.

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

## Permanent Deletion: Subject or Class

Implemented and verified on a physical Android phone.

```mermaid
sequenceDiagram
    actor Teacher
    participant UI as Screen and dialog
    participant UC as Use case
    participant Repo as SQLite repository
    participant DB as SQLite

    Teacher->>UI: Tap Delete on a row
    UI-->>Teacher: Confirm: name, permanent, Cancel first
    Teacher->>UI: Delete
    UI->>UC: deleteClass(id)
    UC->>Repo: delete(id)
    Repo->>DB: BEGIN IMMEDIATE
    Repo->>DB: Record exists?
    Repo->>DB: Count students and exam rows
    alt Dependents exist
        Repo->>DB: ROLLBACK
        Repo-->>UI: IN_USE with counts
        UI-->>Teacher: Dialog explains why it is blocked
    else None
        Repo->>DB: DELETE row (class_subjects rows cascade)
        Repo->>DB: COMMIT
        UI-->>Teacher: Notice "Class deleted permanently"
    end
```

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
