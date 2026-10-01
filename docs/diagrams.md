# Diagrams

Last reviewed: 2026-10-02

All diagrams show the **target** design. Nothing here is implemented yet; see [project.md](./project.md#current-implementation-status). Decisions are governed by [source-of-truth.md](./source-of-truth.md).

## High-Level Mobile Architecture

```mermaid
flowchart TD
    subgraph Device["React Native Mobile App - works offline"]
        UI["UI: React Native Reusables + NativeWind"]
        CAM["Camera"]
        OMR["On-device OMR - OpenCV"]
        LOGIC["Application Logic"]
        DB[("SQLite")]
        QUEUE["Sync Queue"]
    end

    CLOUD[("Optional Cloud: Supabase / PostgreSQL")]

    UI --> CAM
    CAM --> OMR
    OMR --> LOGIC
    UI --> LOGIC
    LOGIC --> DB
    DB <--> QUEUE
    QUEUE <-.->|"only when online"| CLOUD
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
    participant DB as SQLite
    participant Q as Sync Queue
    participant Cloud as Optional Cloud

    Teacher->>App: Select exam and scan sheet
    App->>OMR: Captured image
    OMR-->>App: Detected answers with states
    Teacher->>App: Review and confirm
    App->>DB: Read answer key
    DB-->>App: Answer key
    App->>App: Calculate score
    App->>DB: Save result and answers
    App->>Q: Queue CREATE if sync enabled
    App-->>Teacher: Show result
    Note over App,DB: Everything above works with no internet
    opt Internet available and sync enabled
        Q->>Cloud: Push pending operations
        Cloud-->>Q: Acknowledge
    end
```

## Permanent Delete Flow

```mermaid
flowchart TD
    A["Teacher taps Delete Permanently"] --> B{"Confirmation dialog"}
    B -- Cancel --> Z["No change"]
    B -- "Delete Permanently" --> C["Begin SQLite transaction"]
    C --> D["Delete dependents: student answers, scan metadata"]
    D --> E["Delete result record"]
    E --> F{"Sync enabled?"}
    F -- Yes --> G["Insert remote DELETE into sync queue"]
    F -- No --> H["Commit transaction"]
    G --> H
    H --> I["Delete local scan image file"]
    I --> J["Record disappears from UI immediately"]
    J --> K{"Internet available?"}
    K -- No --> L["DELETE stays queued"]
    L --> K
    K -- Yes --> M["Sync processor sends DELETE to cloud"]
    M --> N{"Cloud confirms, or record already gone?"}
    N -- Yes --> O["Remove DELETE queue entry"]
    N -- No --> P["Increment retry count and back off"]
    P --> K
```

## Sync Architecture

```mermaid
flowchart LR
    DB[("SQLite")] --> OUT["Outbox / Sync Queue"]
    OUT --> NET{"Connectivity?"}
    NET -- Offline --> WAIT["Wait and retry later"]
    WAIT --> NET
    NET -- Online --> PROC["Sync Processor"]
    PROC -->|"push CREATE / UPDATE / DELETE"| CLOUD[("Optional Cloud")]
    CLOUD -->|"pull remote changes"| PROC
    PROC --> GUARD{"Pending local operation for this record?"}
    GUARD -- Yes --> SKIP["Skip remote change - local wins"]
    GUARD -- No --> APPLY["Apply to SQLite"]
    APPLY --> DB
```

## Mobile Navigation

Proposed. No navigation exists in the repository.

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

No schema exists. This is a proposal, not a confirmed design. All `id` columns are device-generated UUIDs.

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
    SYNC_QUEUE {
        string operation_id PK
        string operation_type
        string entity_type
        string entity_id
        string payload
        string created_at
        int retry_count
        string last_error
    }
```

Notes:

- `SYNC_QUEUE` has no foreign keys on purpose: a `DELETE` entry must outlive the record it refers to.
- `TEACHERS` holds a single local profile row. It is not a role or permission table. Whether it is needed before authentication exists is an open decision.
- A student belonging to exactly one class is an assumption; many-to-many enrollment is an open decision.
