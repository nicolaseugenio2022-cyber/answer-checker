/**
 * The geometry of the project's own answer sheet. A sheet is generated for an
 * exact number of questions: a 10-question answer key gets a sheet with
 * questions 1 to 10 and nothing else. One definition is shared by everything
 * that has to agree about where things are on the page: the generator of the
 * printable PDF, the reader that finds bubbles in a photo, and the test images.
 *
 * All measures are millimetres on an A4 portrait page, origin at the top left
 * corner, x to the right and y downward. Nothing is read by absolute size:
 * the reader locates the four registration markers and maps the page onto
 * these coordinates, so a sheet printed at "fit to page" or 95% still works.
 *
 * The number of questions is printed on the sheet in a machine-readable row
 * of cells, so the reader can tell a sheet made for another answer key from
 * the one it expects, instead of misreading it.
 *
 * The layout is original to this project. It is not a copy of any other
 * product's sheet.
 */

import type { AnswerChoice } from '../../answer-keys/domain/answer-key';

export type Point = { x: number; y: number };

export type SheetTemplate = {
  /** Printed on the sheet and stored with every result, for example "AC-10-V2". */
  id: string;
  page: { width: number; height: number };
  /** Exactly how many questions the sheet has. */
  questionCount: number;
  /**
   * Centres of the four solid registration squares, clockwise from the top
   * left: top left, top right, bottom right, bottom left.
   */
  markers: [Point, Point, Point, Point];
  /** Side of a registration square. */
  markerSize: number;
  /**
   * A smaller solid square beside the top-left marker only. The page looks
   * the same turned upside down except for this square, so it tells the
   * reader which way up the sheet is.
   */
  orientationMarker: { center: Point; size: number };
  /**
   * A row of cells, filled or empty, that spells the sheet's question count.
   * `pattern` is what this sheet prints.
   */
  identity: { cells: Point[]; cellSize: number; pattern: boolean[] };
  /** Radius of an answer bubble. */
  bubbleRadius: number;
  /** How the questions are laid out: columns of rows, read top to bottom, then left to right. */
  layout: {
    rowsPerColumn: number;
    /** x of bubble A in each column that is used. */
    columnAX: number[];
    firstRowY: number;
    rowPitch: number;
    choicePitch: number;
    /** Font size of the question numbers and column letters, in points. */
    labelSize: number;
  };
};

/** The layout version. Sheets of an earlier version are not read. */
const VERSION = 2;

const PAGE = { width: 210, height: 297 };

/** Distance of a registration marker's centre from the page edges. */
const MARKER_INSET = 14.5;

const CHOICE_INDEX: Record<AnswerChoice, number> = { A: 0, B: 1, C: 2, D: 3 };

/** One A4 page holds at most this many questions. A longer answer key cannot be scanned. */
export const MAX_SHEET_QUESTIONS = 100;

/**
 * The page is filled only as densely as the question count needs: large
 * bubbles for a short test, smaller ones for a long test.
 */
const DENSITIES = [
  {
    upTo: 40,
    rowsPerColumn: 20,
    columnAX: [40, 128],
    firstRowY: 85,
    rowPitch: 9.5,
    choicePitch: 14,
    bubbleRadius: 3.25,
    labelSize: 10,
  },
  {
    upTo: 75,
    rowsPerColumn: 25,
    columnAX: [30, 90, 150],
    firstRowY: 84,
    rowPitch: 7.6,
    choicePitch: 10.5,
    bubbleRadius: 2.7,
    labelSize: 8.5,
  },
  {
    upTo: MAX_SHEET_QUESTIONS,
    rowsPerColumn: 25,
    columnAX: [25, 71, 117, 163],
    firstRowY: 84,
    rowPitch: 7.6,
    choicePitch: 9,
    bubbleRadius: 2.6,
    labelSize: 8,
  },
] as const;

/** Bits used to print the question count. Seven bits hold up to 127. */
const COUNT_BITS = 7;

/**
 * The identity row for a question count: a filled start cell, the count in
 * binary (most significant bit first), a parity cell that makes the number of
 * filled count-and-parity cells even, and a filled end cell.
 */
export function identityPattern(questionCount: number): boolean[] {
  const bits: boolean[] = [];
  for (let bit = COUNT_BITS - 1; bit >= 0; bit--) bits.push(((questionCount >> bit) & 1) === 1);
  const parity = bits.filter(Boolean).length % 2 === 1;
  return [true, ...bits, parity, true];
}

/**
 * The question count an identity row spells, or null when the row is not a
 * valid one: a missing start or end cell, wrong parity, or a count no sheet has.
 */
export function decodeIdentity(cells: readonly boolean[]): number | null {
  if (cells.length !== COUNT_BITS + 3) return null;
  if (!cells[0] || !cells[cells.length - 1]) return null;
  const bits = cells.slice(1, 1 + COUNT_BITS);
  const parity = cells[1 + COUNT_BITS];
  if ((bits.filter(Boolean).length + (parity ? 1 : 0)) % 2 !== 0) return null;
  const count = bits.reduce((value, bit) => value * 2 + (bit ? 1 : 0), 0);
  return count >= 1 && count <= MAX_SHEET_QUESTIONS ? count : null;
}

export function fitsOneSheet(questionCount: number): boolean {
  return Number.isInteger(questionCount) && questionCount >= 1 && questionCount <= MAX_SHEET_QUESTIONS;
}

/** The sheet for an exact number of questions. */
export function sheetTemplate(questionCount: number): SheetTemplate {
  if (!fitsOneSheet(questionCount)) {
    throw new RangeError(`An answer sheet holds 1 to ${MAX_SHEET_QUESTIONS} questions, not ${questionCount}.`);
  }
  const density = DENSITIES.find((candidate) => questionCount <= candidate.upTo) ?? DENSITIES[2];
  const columnsUsed = Math.ceil(questionCount / density.rowsPerColumn);

  return {
    id: `AC-${questionCount}-V${VERSION}`,
    page: PAGE,
    questionCount,
    markers: [
      { x: MARKER_INSET, y: MARKER_INSET },
      { x: PAGE.width - MARKER_INSET, y: MARKER_INSET },
      { x: PAGE.width - MARKER_INSET, y: PAGE.height - MARKER_INSET },
      { x: MARKER_INSET, y: PAGE.height - MARKER_INSET },
    ],
    markerSize: 9,
    orientationMarker: { center: { x: 30, y: MARKER_INSET }, size: 5 },
    identity: {
      // Ten 4 mm cells with 2 mm gaps, on the top line between the markers.
      cells: Array.from({ length: COUNT_BITS + 3 }, (_, index) => ({
        x: 124 + index * 6,
        y: MARKER_INSET,
      })),
      cellSize: 4,
      pattern: identityPattern(questionCount),
    },
    bubbleRadius: density.bubbleRadius,
    layout: {
      rowsPerColumn: density.rowsPerColumn,
      columnAX: density.columnAX.slice(0, columnsUsed),
      firstRowY: density.firstRowY,
      rowPitch: density.rowPitch,
      choicePitch: density.choicePitch,
      labelSize: density.labelSize,
    },
  };
}

/** Centre of one bubble. Question numbers start at 1. */
export function bubbleCenter(
  template: SheetTemplate,
  questionNumber: number,
  choice: AnswerChoice
): Point {
  if (questionNumber < 1 || questionNumber > template.questionCount) {
    throw new RangeError(`The ${template.id} sheet has no question ${questionNumber}.`);
  }
  const { rowsPerColumn, columnAX, firstRowY, rowPitch, choicePitch } = template.layout;
  const index = questionNumber - 1;
  const column = Math.floor(index / rowsPerColumn);
  const row = index % rowsPerColumn;
  return {
    x: columnAX[column] + CHOICE_INDEX[choice] * choicePitch,
    y: firstRowY + row * rowPitch,
  };
}

/** Where the question number is printed, right-aligned to this x. */
export function questionLabelAnchor(template: SheetTemplate, questionNumber: number): Point {
  const first = bubbleCenter(template, questionNumber, 'A');
  return { x: first.x - template.bubbleRadius - 2.6, y: first.y };
}

/** Where the letter of a choice is printed above each column of bubbles that is used. */
export function columnHeaderAnchors(template: SheetTemplate): { choice: AnswerChoice; at: Point }[] {
  const { columnAX, firstRowY, choicePitch } = template.layout;
  const anchors: { choice: AnswerChoice; at: Point }[] = [];
  for (const columnX of columnAX) {
    for (const choice of ['A', 'B', 'C', 'D'] as const) {
      anchors.push({
        choice,
        at: { x: columnX + CHOICE_INDEX[choice] * choicePitch, y: firstRowY - 7 },
      });
    }
  }
  return anchors;
}

/** The point a location lands on when the page is turned upside down. */
export function rotatedHalfTurn(template: SheetTemplate, point: Point): Point {
  return { x: template.page.width - point.x, y: template.page.height - point.y };
}
