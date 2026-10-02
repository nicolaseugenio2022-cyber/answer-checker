// Verifies the answer-sheet template, the pure classification, review, scoring
// and selection rules, the PNG codec, and the sheet reader. The reader is the
// same TypeScript that runs on the phone; here it reads generated pictures of
// the project's own answer sheets, of several question counts, whose content is known.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';

import {
  DETECTION_THRESHOLDS,
  classifyQuestion,
  countStates,
  reviewState,
  setReviewAnswer,
  startReview,
  unresolvedCount,
} from '../../src/features/scan/domain/detection.ts';
import { previewScore, scoreReview } from '../../src/features/scan/domain/scoring.ts';
import {
  EMPTY_SELECTION,
  isComplete,
  selectAnswerKey,
  selectClass,
  selectStudent,
  selectSubject,
} from '../../src/features/scan/domain/selection.ts';
import { buildAnswerSheetPdf } from '../../src/features/scan/domain/sheet-pdf.ts';
import {
  MAX_SHEET_QUESTIONS,
  bubbleCenter,
  columnHeaderAnchors,
  decodeIdentity,
  fitsOneSheet,
  identityPattern,
  questionLabelAnchor,
  rotatedHalfTurn,
  sheetTemplate,
} from '../../src/features/scan/domain/template.ts';
import {
  applyHomography,
  homographyFromPoints,
} from '../../src/features/scan/infrastructure/omr/homography.ts';
import {
  PngError,
  decodePngToGray,
  encodeGrayToPng,
} from '../../src/features/scan/infrastructure/omr/png.ts';
import { OMR_SETTINGS, readSheet } from '../../src/features/scan/infrastructure/omr/read-sheet.ts';
import { drawSheet, photograph } from './sheet-renderer.mjs';

// The sheet most reader tests use: the one generated for a 40-question answer key.
const T = sheetTemplate(40);
const CHOICES = ['A', 'B', 'C', 'D'];

/** Marks for every question of a sheet, cycling through the four letters. */
function cyclingMarks(count = 40) {
  const marks = {};
  for (let question = 1; question <= count; question++) marks[question] = CHOICES[question % 4];
  return marks;
}

const read = (photo, template = T) => readSheet(photo, template);
const answers = (outcome) => outcome.detections.map((detection) => detection.answer);
const expected = (marks, count = 40) =>
  Array.from({ length: count }, (_, index) => {
    const mark = marks[index + 1];
    return typeof mark === 'string' && mark.length === 1 ? mark : null;
  });

function assertReads(photo, marks, label, template = T) {
  const outcome = read(photo, template);
  assert.equal(outcome.ok, true, `${label}: ${outcome.ok ? '' : outcome.problem}`);
  assert.deepEqual(answers(outcome), expected(marks, template.questionCount), label);
  return outcome;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const ALL_COUNTS = Array.from({ length: MAX_SHEET_QUESTIONS }, (_, index) => index + 1);

describe('answer sheet template', () => {
  it('is generated for an exact number of questions, from 1 to the most one page holds', () => {
    assert.equal(MAX_SHEET_QUESTIONS, 100);
    for (const count of ALL_COUNTS) {
      const template = sheetTemplate(count);
      assert.equal(template.questionCount, count);
      assert.equal(template.id, `AC-${count}-V2`);
      assert.deepEqual(template.page, { width: 210, height: 297 });
      assert.equal(template.markers.length, 4);
      assert.equal(fitsOneSheet(count), true);
      // There is no question after the last one: nothing to print, nothing to read.
      assert.throws(() => bubbleCenter(template, count + 1, 'A'), RangeError);
      assert.throws(() => bubbleCenter(template, 0, 'A'), RangeError);
    }
    for (const count of [0, -1, 101, 200, 2.5, Number.NaN]) {
      assert.equal(fitsOneSheet(count), false, String(count));
      assert.throws(() => sheetTemplate(count), RangeError);
    }
  });

  it('uses only as many columns as the questions need, and no spare rows', () => {
    const columns = (count) => sheetTemplate(count).layout.columnAX.length;
    assert.deepEqual([1, 10, 20, 21, 40].map(columns), [1, 1, 1, 2, 2]);
    assert.deepEqual([41, 50, 51, 75].map(columns), [2, 2, 3, 3]);
    assert.deepEqual([76, 100].map(columns), [4, 4]);
    // Column letters are printed above used columns only.
    assert.equal(columnHeaderAnchors(sheetTemplate(10)).length, 4);
    assert.equal(columnHeaderAnchors(sheetTemplate(100)).length, 16);
    // A short test gets large bubbles; a long one gets smaller bubbles.
    assert.ok(sheetTemplate(10).bubbleRadius > sheetTemplate(100).bubbleRadius);
  });

  it('keeps every bubble and question number on the page, clear of the markers and the header', () => {
    for (const count of ALL_COUNTS) {
      const template = sheetTemplate(count);
      for (let question = 1; question <= count; question++) {
        for (const choice of CHOICES) {
          const { x, y } = bubbleCenter(template, question, choice);
          assert.ok(x > 22 && x < 193 && y > 78 && y < 272, `${count} questions: ${question}${choice}`);
          for (const marker of template.markers) {
            assert.ok(Math.hypot(x - marker.x, y - marker.y) > template.markerSize * 1.5, 'a bubble is too close to a marker');
          }
        }
        assert.ok(questionLabelAnchor(template, question).x > 18);
      }
    }
  });

  it('places every bubble apart from every other, at each density', () => {
    for (const count of [40, 75, 100]) {
      const template = sheetTemplate(count);
      const centers = [];
      for (let question = 1; question <= count; question++) {
        for (const choice of CHOICES) centers.push(bubbleCenter(template, question, choice));
      }
      const minimum = template.bubbleRadius * 2 + 2;
      for (let a = 0; a < centers.length; a++) {
        for (let b = a + 1; b < centers.length; b++) {
          const gap = Math.hypot(centers[a].x - centers[b].x, centers[a].y - centers[b].y);
          assert.ok(gap >= minimum, `${count} questions: bubbles ${a} and ${b} are ${gap} mm apart`);
        }
      }
    }
  });

  it('prints the question count in the identity row, and reads it back', () => {
    const seen = new Set();
    for (const count of ALL_COUNTS) {
      const pattern = identityPattern(count);
      assert.equal(pattern.length, 10);
      assert.deepEqual(sheetTemplate(count).identity.pattern, pattern);
      assert.equal(decodeIdentity(pattern), count);
      seen.add(pattern.map(Number).join(''));
      // One wrongly read cell never turns a sheet into a sheet of another count.
      for (let cell = 0; cell < pattern.length; cell++) {
        const damaged = [...pattern];
        damaged[cell] = !damaged[cell];
        assert.equal(decodeIdentity(damaged), null, `${count} questions, cell ${cell}`);
      }
    }
    assert.equal(seen.size, MAX_SHEET_QUESTIONS);
    // Counts no sheet has, and rows of the wrong length.
    assert.equal(decodeIdentity(identityPattern(0)), null);
    assert.equal(decodeIdentity(identityPattern(101)), null);
    assert.equal(decodeIdentity(identityPattern(127)), null);
    assert.equal(decodeIdentity([true, false, true]), null);
    assert.equal(decodeIdentity(new Array(10).fill(false)), null);
  });

  it('has the markers, the orientation square, and the identity row in the same place on every sheet', () => {
    const reference = sheetTemplate(1);
    for (const count of [10, 40, 41, 75, 76, 100]) {
      const template = sheetTemplate(count);
      assert.deepEqual(template.markers, reference.markers);
      assert.deepEqual(template.orientationMarker, reference.orientationMarker);
      assert.deepEqual(template.identity.cells, reference.identity.cells);
      assert.equal(template.identity.cellSize, reference.identity.cellSize);
    }
  });

  it('is not symmetric under a half turn: the orientation square has no twin', () => {
    const twin = rotatedHalfTurn(T, T.orientationMarker.center);
    const printed = [...T.markers, T.orientationMarker.center, ...T.identity.cells];
    for (const point of printed) {
      assert.ok(Math.hypot(point.x - twin.x, point.y - twin.y) > 8, 'something is printed at the twin position');
    }
    for (const marker of T.markers) {
      assert.ok(marker.x - T.markerSize / 2 >= 8 && marker.y - T.markerSize / 2 >= 8);
    }
  });
});

describe('printable answer sheet PDF', () => {
  const textOf = (count) => Buffer.from(buildAnswerSheetPdf(sheetTemplate(count))).toString('latin1');
  /** The strings the page shows, in order. */
  const shown = (pdf) => [...pdf.matchAll(/\((.*?)\) Tj/g)].map((match) => match[1]);
  const numbers = (pdf) => shown(pdf).filter((value) => /^\d+$/.test(value)).map(Number);
  const circles = (pdf) => pdf.split('\n').filter((line) => line.endsWith(' c')).length / 4;

  it('prints only questions 1 to 10 for a 10-question answer key', () => {
    const pdf = textOf(10);
    assert.deepEqual(numbers(pdf), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(circles(pdf), 40);
    // One column: one set of the letters A to D.
    assert.deepEqual(shown(pdf).filter((value) => /^[ABCD]$/.test(value)), CHOICES);
    assert.ok(shown(pdf).includes('10 questions'));
    assert.ok(shown(pdf).some((value) => value.startsWith('AC-10-V2')));
    assert.doesNotMatch(shown(pdf).join(' '), /40|up to/i);
  });

  it('prints exactly the questions of the answer key, for every count', () => {
    for (const count of ALL_COUNTS) {
      const pdf = textOf(count);
      assert.deepEqual(numbers(pdf), ALL_COUNTS.slice(0, count), `${count} questions`);
      assert.equal(circles(pdf), count * 4, `${count} questions`);
      assert.ok(shown(pdf).includes(count === 1 ? '1 question' : `${count} questions`));
    }
  });

  it('is a well-formed one-page PDF', () => {
    const bytes = buildAnswerSheetPdf(sheetTemplate(25));
    assert.ok(bytes instanceof Uint8Array);
    const pdf = Buffer.from(bytes).toString('latin1');
    assert.ok(pdf.startsWith('%PDF-1.4\n'));
    assert.ok(pdf.endsWith('%%EOF\n'));
    assert.match(pdf, /\/Count 1 /);
    assert.match(pdf, /\/MediaBox \[0 0 595\.276 841\.89\]/);
    // The cross-reference table is where the trailer says, and every object where the table says.
    const xrefAt = Number(pdf.match(/startxref\n(\d+)\n/)[1]);
    assert.equal(pdf.slice(xrefAt, xrefAt + 4), 'xref');
    const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n /gm)].map((match) => Number(match[1]));
    assert.equal(offsets.length, 7);
    offsets.forEach((offset, index) => assert.ok(pdf.startsWith(`${index + 1} 0 obj`, offset)));
    // The declared stream length is the real one.
    const length = Number(pdf.match(/\/Length (\d+)/)[1]);
    const stream = pdf.slice(pdf.indexOf('stream\n') + 7, pdf.indexOf('\nendstream'));
    assert.equal(stream.length, length);
    // Bytes are plain ASCII: nothing was lost turning text into bytes.
    assert.ok(bytes.every((byte) => byte < 128));
  });

  it('draws the machine-read squares of the template: 4 markers, 1 orientation square, the identity cells', () => {
    for (const count of [10, 100]) {
      const squares = textOf(count).split('\n').filter((line) => line.endsWith(' re f')).length;
      assert.equal(squares, 5 + identityPattern(count).filter(Boolean).length);
    }
  });

  it('is the same bytes every time', () => {
    assert.deepEqual(buildAnswerSheetPdf(sheetTemplate(10)), buildAnswerSheetPdf(sheetTemplate(10)));
  });
});

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

describe('classification of one question', () => {
  const state = (fills) => {
    const detection = classifyQuestion(1, fills);
    return [detection.state, detection.answer];
  };

  it('reads each single clear mark as that letter', () => {
    assert.deepEqual(state([0.95, 0.02, 0.0, 0.03]), ['marked', 'A']);
    assert.deepEqual(state([0.0, 0.9, 0.0, 0.0]), ['marked', 'B']);
    assert.deepEqual(state([0.05, 0.0, 0.8, 0.0]), ['marked', 'C']);
    assert.deepEqual(state([0.0, 0.0, 0.1, 0.7]), ['marked', 'D']);
  });

  it('reads no mark as blank and two full marks as multiple', () => {
    assert.deepEqual(state([0, 0, 0, 0]), ['blank', null]);
    assert.deepEqual(state([0.05, 0.1, 0.02, 0.14]), ['blank', null]);
    assert.deepEqual(state([0.9, 0.0, 0.85, 0.0]), ['multiple', null]);
    assert.deepEqual(state([0.6, 0.7, 0.8, 0.9]), ['multiple', null]);
  });

  it('reports a faint mark as unclear instead of choosing it', () => {
    assert.deepEqual(state([0.0, 0.3, 0.0, 0.0]), ['unclear', null]);
    assert.deepEqual(state([0.0, 0.0, 0.0, 0.49]), ['unclear', null]);
  });

  it('accepts a clear mark beside an erased one, but not beside a heavy smudge', () => {
    assert.deepEqual(state([0.95, 0.0, 0.3, 0.0]), ['marked', 'A']);
    assert.deepEqual(state([0.95, 0.0, 0.45, 0.0]), ['unclear', null]);
  });

  it('never picks the darkest bubble when it does not lead by the required margin', () => {
    const { markedFill, separation } = DETECTION_THRESHOLDS;
    const strongest = markedFill + 0.05;
    assert.deepEqual(state([strongest, strongest - separation + 0.05, 0, 0]), ['unclear', null]);
    assert.deepEqual(state([0.9, 0.45, 0, 0]), ['unclear', null]);
  });

  it('gives a confidence from 0 to 1, higher for cleaner cases', () => {
    const clean = classifyQuestion(1, [1, 0, 0, 0]);
    const weak = classifyQuestion(1, [0.7, 0.3, 0, 0]);
    assert.equal(clean.state, 'marked');
    assert.equal(weak.state, 'marked');
    assert.ok(clean.confidence > weak.confidence);
    for (const fills of [[1, 0, 0, 0], [0, 0, 0, 0], [0.9, 0.9, 0, 0], [0.3, 0.2, 0.1, 0], [0.7, 0.3, 0, 0]]) {
      const { confidence } = classifyQuestion(1, fills);
      assert.ok(confidence >= 0 && confidence <= 1, `confidence ${confidence}`);
    }
  });
});

describe('review', () => {
  const detections = [
    classifyQuestion(1, [1, 0, 0, 0]), // marked A
    classifyQuestion(2, [0, 0, 0, 0]), // blank
    classifyQuestion(3, [1, 1, 0, 0]), // multiple
    classifyQuestion(4, [0, 0.3, 0, 0]), // unclear
  ];

  it('starts with marked questions resolved and the others waiting for the Teacher', () => {
    const items = startReview(detections);
    assert.deepEqual(items.map((item) => item.isResolved), [true, false, false, false]);
    assert.deepEqual(items.map((item) => item.finalAnswer), ['A', null, null, null]);
    assert.equal(unresolvedCount(items), 3);
    assert.deepEqual(countStates(items), { marked: 1, blank: 1, multiple: 1, unclear: 1 });
    assert.deepEqual(items.map(reviewState), ['marked', 'blank', 'multiple', 'unclear']);
  });

  it('lets a blank be confirmed as blank without calling it a correction', () => {
    const items = setReviewAnswer(startReview(detections), 2, null);
    assert.equal(items[1].isResolved, true);
    assert.equal(items[1].finalAnswer, null);
    assert.equal(items[1].wasCorrected, false);
    assert.equal(reviewState(items[1]), 'blank');
  });

  it('records a letter chosen for a blank, multiple, or unclear question as a manual correction', () => {
    let items = startReview(detections);
    items = setReviewAnswer(items, 2, 'C');
    items = setReviewAnswer(items, 3, 'A');
    items = setReviewAnswer(items, 4, null);
    assert.deepEqual(items.map((item) => item.finalAnswer), ['A', 'C', 'A', null]);
    assert.deepEqual(items.map((item) => item.wasCorrected), [false, true, true, true]);
    assert.deepEqual(items.map(reviewState), ['marked', 'manually_corrected', 'manually_corrected', 'manually_corrected']);
    assert.equal(unresolvedCount(items), 0);
    // The detection itself is kept as read.
    assert.deepEqual(items.map((item) => item.detection.state), ['marked', 'blank', 'multiple', 'unclear']);
  });

  it('treats choosing the letter already read as a confirmation, and another letter as a correction', () => {
    const same = setReviewAnswer(startReview(detections), 1, 'A');
    assert.equal(same[0].wasCorrected, false);
    const changed = setReviewAnswer(startReview(detections), 1, 'D');
    assert.equal(changed[0].wasCorrected, true);
    assert.equal(changed[0].finalAnswer, 'D');
    const back = setReviewAnswer(changed, 1, 'A');
    assert.equal(back[0].wasCorrected, false);
  });
});

describe('scoring', () => {
  const key = ['A', 'B', 'C', 'D'];
  const reviewOf = (fillsPerQuestion) =>
    startReview(fillsPerQuestion.map((fills, index) => classifyQuestion(index + 1, fills)));
  const marked = (letter) => CHOICES.map((choice) => (choice === letter ? 1 : 0));

  it('gives one point per correct answer: a perfect score, zero, and a mix', () => {
    const perfect = scoreReview(reviewOf(key.map(marked)), key);
    assert.deepEqual([perfect.value.score, perfect.value.total], [4, 4]);

    const zero = scoreReview(reviewOf(['B', 'C', 'D', 'A'].map(marked)), key);
    assert.deepEqual([zero.value.score, zero.value.total], [0, 4]);

    const mixed = scoreReview(reviewOf(['A', 'A', 'C', 'A'].map(marked)), key);
    assert.equal(mixed.value.score, 2);
    assert.deepEqual(mixed.value.answers.map((answer) => answer.isCorrect), [true, false, true, false]);
  });

  it('scores a confirmed blank as incorrect', () => {
    let items = reviewOf([marked('A'), [0, 0, 0, 0], marked('C'), marked('D')]);
    items = setReviewAnswer(items, 2, null);
    const scored = scoreReview(items, key);
    assert.equal(scored.value.score, 3);
    assert.deepEqual(scored.value.answers[1], {
      questionNumber: 2,
      correctAnswer: 'B',
      finalAnswer: null,
      isCorrect: false,
      state: 'blank',
      detectedState: 'blank',
      detectedAnswer: null,
      wasCorrected: false,
      confidence: scored.value.answers[1].confidence,
    });
  });

  it('refuses to score while a multiple, unclear, or blank question is unresolved', () => {
    for (const fills of [[1, 1, 0, 0], [0, 0.3, 0, 0], [0, 0, 0, 0]]) {
      const items = reviewOf([marked('A'), fills, marked('C'), marked('D')]);
      assert.deepEqual(scoreReview(items, key), { ok: false, problem: 'UNRESOLVED' });
    }
  });

  it('scores a manual correction and keeps what was read', () => {
    let items = reviewOf([marked('A'), [1, 1, 0, 0], marked('C'), marked('A')]);
    items = setReviewAnswer(items, 2, 'B');
    items = setReviewAnswer(items, 4, 'D');
    const scored = scoreReview(items, key);
    assert.equal(scored.value.score, 4);
    assert.equal(scored.value.answers[1].state, 'manually_corrected');
    assert.equal(scored.value.answers[1].detectedAnswer, null);
    assert.equal(scored.value.answers[3].detectedAnswer, 'A');
    assert.equal(scored.value.answers[3].wasCorrected, true);
  });

  it('stores the correct answer of every question as a snapshot', () => {
    const scored = scoreReview(reviewOf(key.map(marked)), key);
    assert.deepEqual(scored.value.answers.map((answer) => answer.correctAnswer), key);
    key[0] = 'D';
    assert.equal(scored.value.answers[0].correctAnswer, 'A');
    key[0] = 'A';
  });

  it('keeps the score between 0 and the number of questions, and rejects a mismatched review', () => {
    for (const letters of [['A', 'B', 'C', 'D'], ['D', 'D', 'D', 'D'], ['B', 'B', 'B', 'B']]) {
      const { score, total } = scoreReview(reviewOf(letters.map(marked)), key).value;
      assert.ok(score >= 0 && score <= total);
    }
    assert.deepEqual(scoreReview(reviewOf(key.slice(0, 3).map(marked)), key), {
      ok: false,
      problem: 'QUESTIONS_DO_NOT_MATCH',
    });
    assert.deepEqual(scoreReview(reviewOf([...key, 'A'].map(marked)), key), {
      ok: false,
      problem: 'QUESTIONS_DO_NOT_MATCH',
    });
  });

  it('previews the score counting unresolved questions as incorrect', () => {
    const items = reviewOf([marked('A'), [1, 1, 0, 0], marked('C'), marked('A')]);
    assert.deepEqual(previewScore(items, key), { score: 2, total: 4 });
  });
});

describe('scan selection', () => {
  const full = { subjectId: 'sub-1', answerKeyId: 'key-1', classId: 'cls-1', studentId: 'stu-1' };

  it('is complete only when all four choices are made', () => {
    assert.equal(isComplete(EMPTY_SELECTION), false);
    assert.equal(isComplete({ ...full, studentId: null }), false);
    assert.equal(isComplete(full), true);
  });

  it('clears the answer key, class, and student when the new subject is not taught to the class', () => {
    assert.deepEqual(selectSubject(full, 'sub-2', ['cls-9']), {
      subjectId: 'sub-2',
      answerKeyId: null,
      classId: null,
      studentId: null,
    });
  });

  it('keeps the class and student, but never the answer key, when the class also takes the new subject', () => {
    assert.deepEqual(selectSubject(full, 'sub-2', ['cls-1', 'cls-9']), {
      subjectId: 'sub-2',
      answerKeyId: null,
      classId: 'cls-1',
      studentId: 'stu-1',
    });
  });

  it('changes nothing when the same subject is chosen again', () => {
    assert.equal(selectSubject(full, 'sub-1', []), full);
  });

  it('clears the student when the class changes, and only then', () => {
    assert.deepEqual(selectClass(full, 'cls-2'), { ...full, classId: 'cls-2', studentId: null });
    assert.equal(selectClass(full, 'cls-1'), full);
    assert.deepEqual(selectAnswerKey(full, 'key-2'), { ...full, answerKeyId: 'key-2' });
    assert.deepEqual(selectStudent(full, 'stu-2'), { ...full, studentId: 'stu-2' });
  });
});

// ---------------------------------------------------------------------------
// Image plumbing
// ---------------------------------------------------------------------------

describe('homography', () => {
  it('maps the four given points exactly and others consistently', () => {
    const source = [{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 297 }, { x: 0, y: 297 }];
    const destination = [{ x: 120, y: 80 }, { x: 900, y: 140 }, { x: 1010, y: 1500 }, { x: 60, y: 1420 }];
    const h = homographyFromPoints(source, destination);
    source.forEach((point, index) => {
      const mapped = applyHomography(h, point);
      assert.ok(Math.hypot(mapped.x - destination[index].x, mapped.y - destination[index].y) < 1e-6);
    });
    const back = homographyFromPoints(destination, source);
    const round = applyHomography(back, applyHomography(h, { x: 100, y: 150 }));
    assert.ok(Math.hypot(round.x - 100, round.y - 150) < 1e-6);
  });

  it('returns null for points that do not define a map', () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    assert.equal(homographyFromPoints(line, line), null);
  });
});

describe('PNG codec', () => {
  const gradient = { width: 37, height: 23, data: Uint8Array.from({ length: 37 * 23 }, (_, i) => (i * 7) % 256) };

  it('writes a grayscale PNG that it reads back unchanged', () => {
    const bytes = encodeGrayToPng(gradient);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const decoded = decodePngToGray(bytes);
    assert.equal(decoded.width, 37);
    assert.equal(decoded.height, 23);
    assert.deepEqual(decoded.data, gradient.data);
  });

  it('compresses a sheet-sized picture far below its raw size', () => {
    const outcome = read(photograph(drawSheet(T, cyclingMarks()), T));
    const bytes = encodeGrayToPng(outcome.rectified);
    assert.ok(bytes.length < outcome.rectified.data.length / 4, `${bytes.length} bytes`);
    assert.deepEqual(decodePngToGray(bytes).data, outcome.rectified.data);
  });

  /** A PNG as another program writes it: RGBA or RGB, with any row filter. */
  function foreignPng(width, height, channels, filter, pixel) {
    const colorType = channels === 4 ? 6 : channels === 3 ? 2 : channels === 2 ? 4 : 0;
    const stride = width * channels;
    const rows = [];
    let previous = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
      const row = new Uint8Array(stride);
      for (let x = 0; x < width; x++) pixel(x, y).forEach((value, c) => (row[x * channels + c] = value));
      const out = new Uint8Array(stride + 1);
      out[0] = filter;
      for (let i = 0; i < stride; i++) {
        const left = i >= channels ? row[i - channels] : 0;
        const up = previous[i];
        const upLeft = i >= channels ? previous[i - channels] : 0;
        let predicted = 0;
        if (filter === 1) predicted = left;
        if (filter === 2) predicted = up;
        if (filter === 3) predicted = (left + up) >> 1;
        if (filter === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        out[i + 1] = (row[i] - predicted) & 0xff;
      }
      rows.push(out);
      previous = row;
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const chunk = (type, payload) => {
      const out = Buffer.alloc(payload.length + 12);
      out.writeUInt32BE(payload.length, 0);
      out.write(type, 4, 'latin1');
      Buffer.from(payload).copy(out, 8);
      let crc = 0xffffffff;
      for (let i = 4; i < 8 + payload.length; i++) crc = crcTable[(crc ^ out[i]) & 0xff] ^ (crc >>> 8);
      out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + payload.length);
      return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = colorType;
    const data = deflateSync(Buffer.concat(rows));
    // Split the image data over two chunks, as large files are.
    const half = Math.floor(data.length / 2);
    return new Uint8Array(
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', data.subarray(0, half)),
        chunk('IDAT', data.subarray(half)),
        chunk('IEND', Buffer.alloc(0)),
      ])
    );
  }

  it('reads RGBA and RGB PNGs with every row filter, as brightness', () => {
    const shade = (x, y) => (x * 11 + y * 5) % 256;
    for (const channels of [4, 3, 2, 1]) {
      for (const filter of [0, 1, 2, 3, 4]) {
        const bytes = foreignPng(19, 13, channels, filter, (x, y) =>
          channels >= 3 ? [shade(x, y), shade(x, y), shade(x, y), 255].slice(0, channels) : [shade(x, y), 255].slice(0, channels)
        );
        const decoded = decodePngToGray(bytes);
        assert.equal(decoded.width, 19);
        for (let y = 0; y < 13; y++) {
          for (let x = 0; x < 19; x++) {
            assert.ok(Math.abs(decoded.data[y * 19 + x] - shade(x, y)) <= 1, `channels ${channels} filter ${filter}`);
          }
        }
      }
    }
  });

  it('weights red, green, and blue as the eye does', () => {
    const decoded = decodePngToGray(foreignPng(3, 1, 3, 0, (x) => [[255, 0, 0], [0, 255, 0], [0, 0, 255]][x]));
    assert.deepEqual([...decoded.data], [76, 149, 28]);
  });

  it('rejects files that are not a supported PNG', () => {
    assert.throws(() => decodePngToGray(new Uint8Array(40)), PngError);
    assert.throws(() => decodePngToGray(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Uint8Array(60)])), PngError);
    const truncated = encodeGrayToPng(gradient).subarray(0, 60);
    assert.throws(() => decodePngToGray(truncated), PngError);
  });
});

// ---------------------------------------------------------------------------
// The reader, on generated photos of the project's own sheet
// ---------------------------------------------------------------------------

describe('sheet reader: sheets it must read', () => {
  const marks = cyclingMarks();
  const page = drawSheet(T, marks);

  it('reads a clean, square photo: every one of 40 answers, and each of A, B, C, D', () => {
    const outcome = assertReads(photograph(page, T), marks, 'clean');
    assert.equal(outcome.templateId, 'AC-40-V2');
    assert.equal(outcome.detections.length, 40);
    assert.deepEqual(new Set(answers(outcome)), new Set(CHOICES));
    assert.ok(outcome.detections.every((detection) => detection.state === 'marked'));
    assert.ok(outcome.detections.every((detection) => detection.confidence > 0.8));
    assert.equal(outcome.diagnostics.quarterTurns, 0);
  });

  it('returns the sheet flattened and upright at 4 pixels per millimetre', () => {
    const outcome = read(photograph(page, T, { quarterTurns: 2 }));
    assert.equal(outcome.pixelsPerMm, 4);
    assert.equal(outcome.rectified.width, 840);
    assert.equal(outcome.rectified.height, 1188);
    // Upright: the orientation square is dark at its printed place, light at its twin.
    const at = (point) => outcome.rectified.data[Math.round(point.y * 4) * 840 + Math.round(point.x * 4)];
    assert.ok(at(T.orientationMarker.center) < 80);
    assert.ok(at(rotatedHalfTurn(T, T.orientationMarker.center)) > 180);
  });

  it('is deterministic: the same picture gives the same result', () => {
    const photo = photograph(page, T, { noise: 6 });
    assert.deepEqual(read(photo).detections, read(photo).detections);
  });

  it('reads a sheet photographed at a moderate angle', () => {
    assertReads(
      photograph(page, T, { corners: [[0.14, 0.1], [0.86, 0.07], [0.97, 0.93], [0.03, 0.96]] }),
      marks,
      'perspective'
    );
    assertReads(
      photograph(page, T, { corners: [[0.2, 0.06], [0.92, 0.14], [0.8, 0.94], [0.08, 0.86]] }),
      marks,
      'rotated about 12 degrees'
    );
  });

  it('reads a sheet lying upside down, and one turned sideways', () => {
    const upsideDown = assertReads(photograph(page, T, { quarterTurns: 2 }), marks, 'half turn');
    assert.equal(upsideDown.diagnostics.quarterTurns, 2);
    const landscape = { width: 1600, height: 1200, corners: [[0.05, 0.06], [0.95, 0.06], [0.95, 0.94], [0.05, 0.94]] };
    assertReads(photograph(page, T, { ...landscape, quarterTurns: 1 }), marks, 'quarter turn');
    assertReads(photograph(page, T, { ...landscape, quarterTurns: 3 }), marks, 'three quarter turns');
  });

  it('reads under uneven light: a shadow across the sheet and a bright patch', () => {
    assertReads(photograph(page, T, { light: (x) => 0.55 + 0.45 * x }), marks, 'shadow');
    assertReads(photograph(page, T, { light: (x, y) => 0.6 + 0.4 * y }), marks, 'vertical shadow');
    assertReads(
      photograph(page, T, { light: (x, y) => 1 + 0.9 * Math.exp(-((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.02) }),
      marks,
      'bright patch'
    );
  });

  it('reads through sensor noise and mild blur', () => {
    assertReads(photograph(page, T, { noise: 20 }), marks, 'noise');
    assertReads(photograph(page, T, { blurRadius: 1 }), marks, 'mild blur');
    assertReads(photograph(page, T, { blurRadius: 2 }), marks, 'soft focus');
  });

  it('reads on a dark desk and on a light one, and at a lower resolution', () => {
    assertReads(photograph(page, T, { desk: 25 }), marks, 'dark desk');
    assertReads(photograph(page, T, { desk: 235 }), marks, 'light desk');
    assertReads(photograph(page, T, { width: 700, height: 930 }), marks, '700 pixels wide');
  });

  it('reads the same sheet printed smaller or larger on the page', () => {
    assertReads(photograph(page, T, { corners: [[0.15, 0.12], [0.85, 0.12], [0.85, 0.88], [0.15, 0.88]] }), marks, 'smaller');
    assertReads(photograph(page, T, { corners: [[0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]] }), marks, 'larger');
  });
});

describe('sheet reader: marks it must not guess', () => {
  const photoOf = (marks, options) => photograph(drawSheet(T, marks), T, options);
  const stateOf = (outcome, question) => {
    const detection = outcome.detections[question - 1];
    return [detection.state, detection.answer];
  };

  it('reads an untouched question as blank and an empty sheet as all blank', () => {
    const outcome = read(photoOf({ 1: 'A', 3: 'C' }));
    assert.deepEqual(stateOf(outcome, 1), ['marked', 'A']);
    assert.deepEqual(stateOf(outcome, 2), ['blank', null]);
    assert.deepEqual(stateOf(outcome, 3), ['marked', 'C']);
    const empty = read(photoOf({}));
    assert.ok(empty.detections.every((detection) => detection.state === 'blank'));
  });

  it('reads two shaded bubbles as multiple', () => {
    const outcome = read(photoOf({ 1: 'AC', 2: 'BCD', 21: 'AD' }));
    assert.deepEqual(stateOf(outcome, 1), ['multiple', null]);
    assert.deepEqual(stateOf(outcome, 2), ['multiple', null]);
    assert.deepEqual(stateOf(outcome, 21), ['multiple', null]);
  });

  it('reads a faint mark as unclear, in good light and in shadow', () => {
    for (const options of [{}, { light: (x) => 0.6 + 0.4 * x }, { noise: 8 }]) {
      const outcome = read(photoOf({ 1: { B: 0.25 }, 20: { D: 0.2 }, 40: { A: 0.28 } }, options));
      assert.deepEqual(stateOf(outcome, 1), ['unclear', null]);
      assert.deepEqual(stateOf(outcome, 20), ['unclear', null]);
      assert.deepEqual(stateOf(outcome, 40), ['unclear', null]);
    }
  });

  it('accepts a clear mark beside a lightly erased one, and flags a heavy leftover', () => {
    const outcome = read(photoOf({ 1: { A: 1, C: 0.12 }, 2: { B: 1, D: 0.3 }, 3: { C: 1, A: 0.02 } }));
    assert.deepEqual(stateOf(outcome, 1), ['marked', 'A']);
    assert.deepEqual(stateOf(outcome, 2), ['unclear', null]);
    assert.deepEqual(stateOf(outcome, 3), ['marked', 'C']);
  });

  it('ignores specks of noise in empty bubbles', () => {
    const outcome = read(photoOf({ 5: 'B' }, { noise: 22 }));
    assert.deepEqual(stateOf(outcome, 5), ['marked', 'B']);
    assert.equal(outcome.detections.filter((detection) => detection.state === 'blank').length, 39);
  });

});

describe('sheet reader: sheets of every size', () => {
  const ANGLED = { corners: [[0.14, 0.1], [0.86, 0.07], [0.97, 0.93], [0.03, 0.96]] };
  const stateOf = (outcome, question) => {
    const detection = outcome.detections[question - 1];
    return [detection.state, detection.answer];
  };

  it('reads exactly the questions of the sheet: 1, 10, 20, 21, 40, 41, 75, 76, and 100', () => {
    for (const count of [1, 10, 20, 21, 40, 41, 75, 76, 100]) {
      const template = sheetTemplate(count);
      const marks = cyclingMarks(count);
      const page = drawSheet(template, marks);
      const outcome = assertReads(photograph(page, template), marks, `${count} questions`, template);
      assert.equal(outcome.templateId, `AC-${count}-V2`);
      assert.equal(outcome.detections.length, count);
      assert.deepEqual(outcome.detections.map((d) => d.questionNumber), Array.from({ length: count }, (_, i) => i + 1));
      assert.ok(outcome.detections.every((detection) => detection.state === 'marked'), `${count} questions`);
    }
  });

  it('reads short and dense sheets at an angle, upside down, in shadow, and through noise and soft focus', () => {
    for (const count of [10, 75, 100]) {
      const template = sheetTemplate(count);
      const marks = cyclingMarks(count);
      const page = drawSheet(template, marks);
      assertReads(photograph(page, template, ANGLED), marks, `${count} at an angle`, template);
      assertReads(photograph(page, template, { quarterTurns: 2 }), marks, `${count} upside down`, template);
      assertReads(photograph(page, template, { light: (x) => 0.55 + 0.45 * x }), marks, `${count} in shadow`, template);
      assertReads(photograph(page, template, { noise: 20 }), marks, `${count} with noise`, template);
      assertReads(photograph(page, template, { blurRadius: 2 }), marks, `${count} in soft focus`, template);
    }
  });

  it('does not guess on a dense sheet: blank, multiple, and faint marks are reported as such', () => {
    const template = sheetTemplate(100);
    const marks = { 1: 'A', 26: 'BC', 50: { D: 0.25 }, 76: 'D', 100: 'C' };
    for (const options of [{}, ANGLED]) {
      const outcome = read(photograph(drawSheet(template, marks), template, options), template);
      assert.equal(outcome.ok, true);
      assert.deepEqual(stateOf(outcome, 1), ['marked', 'A']);
      assert.deepEqual(stateOf(outcome, 26), ['multiple', null]);
      assert.deepEqual(stateOf(outcome, 50), ['unclear', null]);
      assert.deepEqual(stateOf(outcome, 76), ['marked', 'D']);
      assert.deepEqual(stateOf(outcome, 100), ['marked', 'C']);
      assert.equal(outcome.detections.filter((detection) => detection.state === 'blank').length, 95);
    }
  });

  it('refuses a sheet printed for another question count, and says which count it has', () => {
    // [the sheet that was photographed, the answer key's question count]
    for (const [printed, expectedCount] of [[40, 10], [10, 40], [12, 10], [10, 12], [100, 99], [75, 76], [1, 2]]) {
      const sheet = sheetTemplate(printed);
      const photo = photograph(drawSheet(sheet, cyclingMarks(printed)), sheet);
      for (const options of [photo, photograph(drawSheet(sheet, {}), sheet, { quarterTurns: 2 })]) {
        const outcome = readSheet(options, sheetTemplate(expectedCount));
        assert.equal(outcome.ok, false, `${printed} read as ${expectedCount}`);
        assert.equal(outcome.problem, 'WRONG_SHEET');
        assert.equal(outcome.sheetQuestionCount, printed);
        // No answers come from a sheet of the wrong size.
        assert.equal(outcome.detections, undefined);
        assert.equal(outcome.rectified, undefined);
      }
    }
  });
});

describe('sheet reader: pictures it must refuse', () => {
  const marks = cyclingMarks();
  const page = drawSheet(T, marks);
  const refused = (photo, problem, label) => {
    const outcome = read(photo);
    assert.equal(outcome.ok, false, `${label} was read`);
    assert.equal(outcome.problem, problem, label);
    // A refused picture carries no answers at all.
    assert.equal(outcome.detections, undefined);
    assert.equal(outcome.rectified, undefined);
  };

  it('refuses a heavily blurred photo', () => {
    refused(photograph(page, T, { blurRadius: 4 }), 'TOO_BLURRY', 'blur 4');
    refused(photograph(page, T, { blurRadius: 6 }), 'TOO_BLURRY', 'blur 6');
  });

  it('refuses a sheet with a corner marker missing', () => {
    for (const missing of [0, 1, 2, 3]) {
      refused(photograph(drawSheet(T, marks, { omit: [missing] }), T), 'MARKERS_NOT_FOUND', `marker ${missing}`);
    }
  });

  it('refuses a cropped sheet', () => {
    refused(photograph(page, T, { corners: [[0.06, -0.12], [0.94, -0.12], [0.94, 0.9], [0.06, 0.9]] }), 'MARKERS_NOT_FOUND', 'top cut off');
    refused(photograph(page, T, { corners: [[0.2, 0.05], [1.12, 0.05], [1.12, 0.95], [0.2, 0.95]] }), 'MARKERS_NOT_FOUND', 'right side cut off');
  });

  it('refuses a sheet whose identity row is damaged or missing, or without the orientation square', () => {
    const wrongParity = identityPattern(40);
    wrongParity[8] = !wrongParity[8];
    refused(photograph(drawSheet(T, marks, { identity: wrongParity }), T), 'UNSUPPORTED_TEMPLATE', 'wrong parity');
    const noEnd = identityPattern(40);
    noEnd[9] = false;
    refused(photograph(drawSheet(T, marks, { identity: noEnd }), T), 'UNSUPPORTED_TEMPLATE', 'no end cell');
    refused(photograph(drawSheet(T, marks, { omit: ['identity'] }), T), 'UNSUPPORTED_TEMPLATE', 'no identity');
    refused(photograph(drawSheet(T, marks, { omit: ['orientation'] }), T), 'UNSUPPORTED_TEMPLATE', 'no orientation');
  });

  it('refuses a picture with no sheet in it', () => {
    const blank = { width: 1200, height: 1600, data: new Uint8Array(1200 * 1600).fill(180) };
    refused(blank, 'MARKERS_NOT_FOUND', 'blank picture');
  });

  it('refuses a sheet that is a small part of the picture', () => {
    refused(photograph(page, T, { corners: [[0.33, 0.33], [0.67, 0.33], [0.67, 0.67], [0.33, 0.67]] }), 'SHEET_TOO_SMALL', 'far away');
  });

  it('refuses a picture with too few pixels', () => {
    refused(photograph(page, T, { width: 500, height: 660 }), 'IMAGE_TOO_SMALL', 'small picture');
    assert.ok(OMR_SETTINGS.minShortSide > 500);
  });

  it('refuses a picture too dark to tell paper from print', () => {
    refused(photograph(page, T, { light: () => 0.25 }), 'BAD_LIGHTING', 'dark');
  });

  it('refuses a sheet photographed at a steep angle', () => {
    const outcome = read(photograph(page, T, { corners: [[0.25, 0.15], [0.75, 0.15], [0.98, 0.95], [0.02, 0.95]] }));
    assert.equal(outcome.ok, false);
    assert.ok(['MARKERS_NOT_FOUND', 'PERSPECTIVE_UNRELIABLE'].includes(outcome.problem));
  });
});
