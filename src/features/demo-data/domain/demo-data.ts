import type { AnswerChoice } from '../../answer-keys/domain/answer-key';

/**
 * A small, made-up set of records for trying the app out during development:
 * subjects, classes, students, answer keys, and saved results. Every record
 * has an id that starts with DEMO_ID_PREFIX and a name or Student ID that
 * starts with "Demo", so it can be told from the Teacher's own records and
 * removed again. It is offered only in development builds.
 *
 * The data is the same every time, apart from the timestamps, which are
 * counted back from the moment it is added.
 */
export const DEMO_ID_PREFIX = 'de300da7-a000-4000-8000-';

const CHOICES: readonly AnswerChoice[] = ['A', 'B', 'C', 'D'];

const demoId = (group: number, index: number) =>
  `${DEMO_ID_PREFIX}${String(group).padStart(2, '0')}${String(index).padStart(10, '0')}`;

export type DemoAnswer = {
  questionNumber: number;
  detectedState: 'MARKED' | 'BLANK' | 'UNCLEAR';
  detectedAnswer: AnswerChoice | null;
  finalAnswer: AnswerChoice | null;
  correctAnswer: AnswerChoice;
  isCorrect: boolean;
  manuallyCorrected: boolean;
  confidence: number;
};

export type DemoResult = {
  id: string;
  answerKeyId: string;
  studentId: string;
  classId: string;
  studentName: string;
  studentNumber: string;
  className: string;
  subjectName: string;
  answerKeyName: string;
  score: number;
  total: number;
  templateId: string;
  capturedAt: string;
  createdAt: string;
  answers: DemoAnswer[];
  scanRecordId: string;
  /** No file is written: the result shows "Stored scan image is unavailable". */
  imagePath: string;
};

export type DemoData = {
  createdAt: string;
  subjects: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  classSubjects: { classId: string; subjectId: string }[];
  students: { id: string; classId: string; studentNumber: string; fullName: string }[];
  answerKeys: { id: string; subjectId: string; name: string; answers: AnswerChoice[] }[];
  results: DemoResult[];
};

const SUBJECTS = ['Demo Mathematics', 'Demo Science'];
const CLASSES = ['Demo BSIT 1A', 'Demo Grade 11 STEM-A'];

/** [class index, full name] */
const STUDENTS: readonly [number, string][] = [
  [0, 'Maria Santos'],
  [0, 'Paolo Garcia'],
  [0, 'Ana Reyes'],
  [0, 'Jose Dela Cruz'],
  [0, 'Liza Mendoza'],
  [1, 'Carlo Peña'],
  [1, 'Bea Villanueva'],
  [1, 'Miguel Torres'],
];

/** [subject index, name, number of questions] */
const ANSWER_KEYS: readonly [number, string, number][] = [
  [0, 'Demo Quiz 1', 10],
  [0, 'Demo Midterm', 30],
  [1, 'Demo Lab Test', 15],
];

/**
 * Which sheets were "scanned": [answer key index, student index, attempt].
 * Maria has two attempts of Quiz 1.
 */
const SCANS: readonly [number, number, number][] = [
  [0, 0, 1], [0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1], [0, 5, 1], [0, 6, 1], [0, 7, 1],
  [1, 0, 1], [1, 1, 1], [1, 2, 1], [1, 3, 1],
  [2, 5, 1], [2, 6, 1], [2, 7, 1],
  [0, 0, 2],
];

/** One made-up answer: mostly correct, some wrong, a few blank, a few set by the Teacher. */
function demoAnswer(questionNumber: number, correctAnswer: AnswerChoice, seed: number): DemoAnswer {
  const kind = (seed * 31 + questionNumber * 7) % 10;
  if (kind === 8) {
    return {
      questionNumber, correctAnswer,
      detectedState: 'BLANK', detectedAnswer: null, finalAnswer: null,
      isCorrect: false, manuallyCorrected: false, confidence: 0.95,
    };
  }
  if (kind === 9) {
    // Read as unclear; the Teacher chose the letter during the review.
    return {
      questionNumber, correctAnswer,
      detectedState: 'UNCLEAR', detectedAnswer: null, finalAnswer: correctAnswer,
      isCorrect: true, manuallyCorrected: true, confidence: 0.4,
    };
  }
  const given = kind >= 6 ? CHOICES[(CHOICES.indexOf(correctAnswer) + 1) % 4] : correctAnswer;
  return {
    questionNumber, correctAnswer,
    detectedState: 'MARKED', detectedAnswer: given, finalAnswer: given,
    isCorrect: given === correctAnswer, manuallyCorrected: false, confidence: 0.92,
  };
}

/** The whole demo set. `now` is a UTC ISO-8601 timestamp; results are dated before it. */
export function buildDemoData(now: string): DemoData {
  const nowMs = Date.parse(now);
  const before = (minutes: number) => new Date(nowMs - minutes * 60_000).toISOString();

  const subjects = SUBJECTS.map((name, index) => ({ id: demoId(1, index), name }));
  const classes = CLASSES.map((name, index) => ({ id: demoId(2, index), name }));
  const students = STUDENTS.map(([classIndex, fullName], index) => ({
    id: demoId(3, index),
    classId: classes[classIndex].id,
    studentNumber: `DEMO-${String(index + 1).padStart(3, '0')}`,
    fullName,
  }));
  const answerKeys = ANSWER_KEYS.map(([subjectIndex, name, count], index) => ({
    id: demoId(4, index),
    subjectId: subjects[subjectIndex].id,
    name,
    answers: Array.from({ length: count }, (_, question) => CHOICES[(question * 3 + index) % 4]),
  }));

  const results = SCANS.map(([keyIndex, studentIndex, attempt], index): DemoResult => {
    const key = answerKeys[keyIndex];
    const student = students[studentIndex];
    const schoolClass = classes[STUDENTS[studentIndex][0]];
    const subject = subjects[ANSWER_KEYS[keyIndex][0]];
    const answers = key.answers.map((correct, question) =>
      demoAnswer(question + 1, correct, studentIndex + keyIndex * 3 + attempt * 5)
    );
    // Spread over the last two days, the later scans most recent.
    const capturedAt = before((SCANS.length - index) * 173);
    const id = demoId(5, index);
    return {
      id,
      answerKeyId: key.id,
      studentId: student.id,
      classId: schoolClass.id,
      studentName: student.fullName,
      studentNumber: student.studentNumber,
      className: schoolClass.name,
      subjectName: subject.name,
      answerKeyName: key.name,
      score: answers.filter((answer) => answer.isCorrect).length,
      total: answers.length,
      templateId: `AC-${answers.length}-V2`,
      capturedAt,
      createdAt: capturedAt,
      answers,
      scanRecordId: demoId(6, index),
      imagePath: `scans/${id}.png`,
    };
  });

  return {
    createdAt: before(3 * 24 * 60),
    subjects,
    classes,
    // Mathematics is taught to both classes, Science to the second only.
    classSubjects: [
      { classId: classes[0].id, subjectId: subjects[0].id },
      { classId: classes[1].id, subjectId: subjects[0].id },
      { classId: classes[1].id, subjectId: subjects[1].id },
    ],
    students,
    answerKeys,
    results,
  };
}
