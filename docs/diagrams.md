# Diagrams

Last reviewed: 2026-10-02

All diagrams show the **target** design unless marked Implemented. The application is offline-only: every component in every diagram runs on the Teacher's device, and there is no backend, cloud database, or synchronization. Only the app shell, design system, Home dashboard, placeholder screens, and SQLite bootstrap exist today; see [project.md](./project.md#current-implementation-status). Decisions are governed by [source-of-truth.md](./source-of-truth.md).

## High-Level Mobile Architecture

Everything is inside the mobile application on the Teacher's device.

```mermaid
flowchart TD
    subgraph Device["Teacher's device - no network used"]
        UI["Mobile presentation layer: React Native Reusables + NativeWind"]
        APP["Application use cases"]
        DOMAIN["Domain rules"]
        subgraph Infra["Local infrastructure"]
            CAM["Camera"]
            OMR["On-device OMR - OpenCV"]
            REPO["SQLite repositories"]
            FILES["Local file storage: scan images"]
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

Arrows show allowed import direction. Rules are in [source-of-truth.md](./source-of-truth.md#clean-architecture-layers).

```mermaid
flowchart TD
    ROUTES["src/app: routes and composition root"]
    PRES["Presentation: screens, components, hooks"]
    INFRA["Infrastructure, all local: SQLite, local files, camera, OpenCV"]
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

## Answer Sheet Scanning Flow

```mermaid
flowchart TD
    A["Select Exam"] --> B["Camera"]
    B --> C{"Sheet and markers detected?"}
    C -- No --> B
    C -- Yes --> D["Perspective Correction"]
    D --> E["Grayscale and Thresholding"]
    E --> F["Detect Bubbles"]
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
    O -- Confirm --> P["Score against local answer key"]
    P --> Q["Save to SQLite"]
    Q --> R["View Result"]
```

## Offline Data Flow

```mermaid
sequenceDiagram
    actor Teacher
    participant App as Mobile App
    participant OMR as On-device OMR
    participant DB as Local SQLite database
    participant Files as Local file storage

    Teacher->>App: Select exam and scan sheet
    App->>Files: Store captured image
    App->>OMR: Captured image
    OMR-->>App: Detected answers with states
    Teacher->>App: Review and confirm
    App->>DB: Read answer key
    DB-->>App: Answer key
    App->>App: Calculate score
    App->>DB: Save result and answers in one transaction
    App-->>Teacher: Show result
    Note over App,Files: Every step runs on the device. Nothing is sent anywhere.
```

## Permanent Delete Flow

```mermaid
flowchart TD
    A["Teacher taps Delete Permanently"] --> B{"Confirmation dialog"}
    B -- Cancel --> Z["No change"]
    B -- "Delete Permanently" --> C["Begin SQLite transaction"]
    C --> D["Delete dependents: student answers, scan metadata"]
    D --> E["Delete result record"]
    E --> F{"Transaction commits?"}
    F -- No --> R["Roll back: record fully intact, show error"]
    F -- Yes --> G["Delete local scan image file"]
    G --> H["Record disappears from UI"]
    H --> I["Nothing remains: no tombstone, no soft-deleted row"]
```

## Mobile Navigation

Implemented: a bottom tab bar with Home, Exams, Scan, Students, and Results. Classes, Subjects, and Settings are opened from Home, not from a tab. Scan, Exams, Students, Classes, Subjects, and Results are placeholder screens; Settings has a theme switch. The nested screens (Select Exam, Camera, Review Detection, Result Detail, Exam Detail, Answer Key) are planned and do not exist.

```mermaid
flowchart TD
    HOME["Home"] --> SCAN["Scan"]
    HOME --> EXAMS["Exams"]
    HOME --> STUDENTS["Students"]
    HOME --> CLASSES["Classes"]
    HOME --> SUBJECTS["Subjects"]
    HOME --> RESULTS["Results"]
    HOME --> SETTINGS["Settings"]

    SCAN --> SELECT["Select Exam"]
    SELECT --> CAMERA["Camera"]
    CAMERA --> REVIEW["Review Detection"]
    REVIEW --> DETAIL["Result Detail"]

    EXAMS --> EXAMDETAIL["Exam Detail"]
    EXAMDETAIL --> KEY["Answer Key"]
    RESULTS --> DETAIL
```

## Proposed Domain Model

No schema exists: the local SQLite database is created with no tables. This is a proposal, not a confirmed design. All `id` columns are device-generated UUIDs. Every table is in the local SQLite database on the Teacher's device.

```mermaid
erDiagram
    TEACHERS ||--o{ CLASSES : owns
    TEACHERS ||--o{ SUBJECTS : owns
    TEACHERS ||--o{ EXAMS : creates
    CLASSES ||--o{ STUDENTS : contains
    CLASSES ||--o{ EXAMS : takes
    SUBJECTS ||--o{ EXAMS : covers
    EXAMS ||--o{ EXAM_QUESTIONS : has
    EXAM_QUESTIONS ||--o| ANSWER_KEYS : "correct answer"
    EXAMS ||--o{ EXAM_RESULTS : produces
    STUDENTS ||--o{ EXAM_RESULTS : receives
    EXAM_RESULTS ||--o{ STUDENT_ANSWERS : contains
    EXAM_RESULTS ||--o| SCAN_RECORDS : "scanned from"

    TEACHERS {
        string id PK
        string name
        string created_at
    }
    CLASSES {
        string id PK
        string teacher_id FK
        string name
    }
    STUDENTS {
        string id PK
        string class_id FK
        string student_number
        string full_name
    }
    SUBJECTS {
        string id PK
        string teacher_id FK
        string name
    }
    EXAMS {
        string id PK
        string teacher_id FK
        string subject_id FK
        string class_id FK
        string title
        int question_count
        string created_at
    }
    EXAM_QUESTIONS {
        string id PK
        string exam_id FK
        int question_number
        int choice_count
        int points
    }
    ANSWER_KEYS {
        string id PK
        string exam_question_id FK
        string correct_answer
    }
    EXAM_RESULTS {
        string id PK
        string exam_id FK
        string student_id FK
        int score
        int total
        string created_at
    }
    STUDENT_ANSWERS {
        string id PK
        string result_id FK
        int question_number
        string state
        string selected_answer
        boolean is_correct
        boolean teacher_corrected
    }
    SCAN_RECORDS {
        string id PK
        string result_id FK
        string image_path
        string scanned_at
    }
```

Notes:

- `SCAN_RECORDS.image_path` points to a file in local storage on the device.
- No table has a soft-delete or archive column. Permanent physical deletion removes rows.
- `TEACHERS` would hold a single local profile row. It is not an account, role, or permission table, and there is no sign-in. With one Teacher per installation it may be unnecessary; whether to keep it is an open decision.
- A student belonging to exactly one class is an assumption; many-to-many enrollment is an open decision.
