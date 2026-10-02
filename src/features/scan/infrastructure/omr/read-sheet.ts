import { ANSWER_CHOICES } from '../../../answer-keys/domain/answer-key';
import { classifyQuestion, type BubbleFills, type QuestionDetection } from '../../domain/detection';
import type { CaptureProblem, GrayImage } from '../../domain/gray-image';
import {
  bubbleCenter,
  decodeIdentity,
  rotatedHalfTurn,
  type Point,
  type SheetTemplate,
} from '../../domain/template';
import { applyHomography, homographyFromPoints, type Homography } from './homography';

/**
 * Reads the project's answer sheet from a photo, entirely on the device and
 * without any library: plain arithmetic on a grayscale image.
 *
 *   photo -> dark blobs -> four corner markers -> which way up, how many questions
 *         -> the sheet flattened onto its own coordinates -> the darkness of
 *         each bubble at its known place -> a decision per question
 *
 * Bubbles are never searched for in the photo. Once the markers place the
 * sheet, every bubble is measured where the template says it is.
 *
 * It is deterministic: the same picture always gives the same result. When a
 * picture cannot be trusted it is refused with a reason; no answers are made
 * up.
 *
 * Every number that decides something is here. They were set on generated
 * test sheets and are not calibrated on printed sheets yet.
 */
export const OMR_SETTINGS = {
  /** The shorter side of the photo must have at least this many pixels. */
  minShortSide: 600,
  /** Blobs are searched on a copy about this wide; enough to see a marker, fast to scan. */
  searchWidth: 640,
  marker: {
    /** A pixel is dark when it is this much darker than the average around it. */
    darkRatio: 0.72,
    /** ...and darker than the average by at least this many gray levels, to ignore flat noise. */
    minDarkDelta: 18,
    /** Size of "around it", as a share of the picture's width. */
    windowShare: 1 / 6,
    /** A marker's side, as a share of the picture's width, lies between these. */
    minSideShare: 0.012,
    maxSideShare: 0.1,
    /** A solid square fills its bounding box; a ring, a letter, or a line does not. */
    minSolidity: 0.62,
    /** Longest side over shortest side of the bounding box. */
    maxAspect: 1.9,
    /** The four markers may differ in side length by this factor at most (perspective). */
    maxSizeRatio: 2.2,
    /**
     * Each corner blob must have the area a marker would have at that place,
     * within these factors. A shaded bubble has 0.41 of a marker's area, so
     * it cannot stand in for a marker that is out of frame.
     */
    minAreaMatch: 0.72,
    maxAreaMatch: 1.5,
  },
  quad: {
    /** The markers must span at least this share of the picture's area. */
    minAreaShare: 0.12,
    /** Opposite sides of the sheet may differ in length by this factor at most. */
    maxOppositeSideRatio: 1.45,
  },
  /** Resolution of the flattened sheet: 4 pixels per millimetre, 840 x 1188 for A4. */
  pixelsPerMm: 4,
  cell: {
    /** A marker or identity cell is filled above this darkness, empty below `emptyBelow`. */
    filledAbove: 0.55,
    emptyBelow: 0.3,
  },
  bubble: {
    /** Only the middle of a bubble is measured, clear of its printed outline. */
    innerRadiusShare: 0.72,
    /** The paper's brightness is taken from a band around the bubble, between these radii. */
    paperBandInner: 1.35,
    paperBandOuter: 1.75,
    /**
     * A pixel starts to count as ink at this share of the paper's brightness
     * and counts fully at `inkFull`. In between it counts in proportion, so a
     * light pencil mark gives a middling fill rather than all or nothing.
     */
    inkStart: 0.9,
    inkFull: 0.6,
  },
  /** Edge strength around the corner markers relative to their contrast; below this it is blurred. */
  minSharpness: 0.005,
  lighting: {
    /** Paper darker than this (0 to 255) is too dim to read. */
    minPaperBrightness: 80,
    /** Paper and printed black must differ by at least this many gray levels. */
    minContrast: 60,
  },
} as const;

export type OmrDiagnostics = {
  /** Brightness of the paper and of the printed markers on the flattened sheet. */
  paperBrightness?: number;
  inkBrightness?: number;
  sharpness?: number;
  /** How many marker-like blobs were found. */
  markerCandidates?: number;
  /** Quarter turns the sheet was rotated by in the photo. */
  quarterTurns?: number;
};

export type OmrOutcome =
  | {
      ok: true;
      templateId: string;
      /** One decision for every question the sheet has, in order. */
      detections: QuestionDetection[];
      /** The sheet flattened and upright, for the Teacher to look at. */
      rectified: GrayImage;
      pixelsPerMm: number;
      diagnostics: OmrDiagnostics;
    }
  | {
      ok: false;
      problem: CaptureProblem;
      /** With WRONG_SHEET: the question count printed on the photographed sheet. */
      sheetQuestionCount?: number;
      diagnostics: OmrDiagnostics;
    };

type Blob = { x: number; y: number; width: number; height: number; area: number };

// ---------------------------------------------------------------------------
// Finding the markers
// ---------------------------------------------------------------------------

/** A smaller copy, each pixel the average of a `factor` x `factor` block. */
function shrink(image: GrayImage, factor: number): GrayImage {
  if (factor <= 1) return image;
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8Array(width * height);
  const blockArea = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * image.width + x * factor;
        for (let dx = 0; dx < factor; dx++) sum += image.data[row + dx];
      }
      data[y * width + x] = sum / blockArea;
    }
  }
  return { width, height, data };
}

/**
 * Marks the pixels that are clearly darker than their surroundings. Comparing
 * with the local average, not with one fixed level, keeps it working when one
 * side of the sheet is in shadow.
 */
function darkMask(image: GrayImage): Uint8Array {
  const { width, height, data } = image;
  const { darkRatio, minDarkDelta, windowShare } = OMR_SETTINGS.marker;
  // sums[y][x] = sum of all pixels above and to the left, for fast window averages.
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += data[y * width + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + rowSum;
    }
  }
  const half = Math.max(8, Math.round((width * windowShare) / 2));
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - half);
    const bottom = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - half);
      const right = Math.min(width, x + half + 1);
      const total =
        sums[bottom * stride + right] -
        sums[top * stride + right] -
        sums[bottom * stride + left] +
        sums[top * stride + left];
      const mean = total / ((bottom - top) * (right - left));
      const value = data[y * width + x];
      if (value < mean * darkRatio && mean - value >= minDarkDelta) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** Groups touching dark pixels and describes each group. */
function findBlobs(mask: Uint8Array, width: number, height: number): Blob[] {
  const blobs: Blob[] = [];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let size = 0;
    stack[size++] = start;
    mask[start] = 2;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    let area = 0;
    while (size > 0) {
      const index = stack[--size];
      const x = index % width;
      const y = (index - x) / width;
      area++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[index - 1] === 1) {
        mask[index - 1] = 2;
        stack[size++] = index - 1;
      }
      if (x < width - 1 && mask[index + 1] === 1) {
        mask[index + 1] = 2;
        stack[size++] = index + 1;
      }
      if (y > 0 && mask[index - width] === 1) {
        mask[index - width] = 2;
        stack[size++] = index - width;
      }
      if (y < height - 1 && mask[index + width] === 1) {
        mask[index + width] = 2;
        stack[size++] = index + width;
      }
    }
    blobs.push({
      x: sumX / area,
      y: sumY / area,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      area,
    });
  }
  return blobs;
}

/** Keeps the blobs that have the size and solidity of a printed square. */
function markerCandidates(blobs: Blob[], imageWidth: number): Blob[] {
  const { minSideShare, maxSideShare, minSolidity, maxAspect } = OMR_SETTINGS.marker;
  const minSide = imageWidth * minSideShare;
  const maxSide = imageWidth * maxSideShare;
  return blobs.filter((blob) => {
    const long = Math.max(blob.width, blob.height);
    const short = Math.min(blob.width, blob.height);
    return (
      short >= minSide &&
      long <= maxSide &&
      long / short <= maxAspect &&
      blob.area / (blob.width * blob.height) >= minSolidity
    );
  });
}

/**
 * The four candidates at the corners of the picture's content: top left, top
 * right, bottom right, bottom left. The sheet's markers are its outermost
 * solid squares, so they are the extreme ones in the four diagonal directions.
 */
function pickCorners(candidates: Blob[]): [Blob, Blob, Blob, Blob] | null {
  if (candidates.length < 4) return null;
  const extreme = (score: (blob: Blob) => number) =>
    candidates.reduce((best, blob) => (score(blob) > score(best) ? blob : best));
  const corners: [Blob, Blob, Blob, Blob] = [
    extreme((blob) => -blob.x - blob.y),
    extreme((blob) => blob.x - blob.y),
    extreme((blob) => blob.x + blob.y),
    extreme((blob) => -blob.x + blob.y),
  ];
  if (new Set(corners).size !== 4) return null;
  const sides = corners.map((blob) => Math.sqrt(blob.area));
  if (Math.max(...sides) / Math.min(...sides) > OMR_SETTINGS.marker.maxSizeRatio) return null;
  return corners;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Twice the signed area of the triangle a, b, c. Its sign says which way the corner turns. */
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Whether four corners form a usable outline of the sheet, and if not, why. */
function checkQuad(corners: Point[], image: GrayImage): CaptureProblem | null {
  const turns = corners.map((corner, index) =>
    cross(corner, corners[(index + 1) % 4], corners[(index + 2) % 4])
  );
  if (!turns.every((turn) => turn > 0)) return 'PERSPECTIVE_UNRELIABLE';

  const area = (Math.abs(cross(corners[0], corners[1], corners[2])) + Math.abs(cross(corners[0], corners[2], corners[3]))) / 2;
  if (area < image.width * image.height * OMR_SETTINGS.quad.minAreaShare) return 'SHEET_TOO_SMALL';

  const top = distance(corners[0], corners[1]);
  const right = distance(corners[1], corners[2]);
  const bottom = distance(corners[2], corners[3]);
  const left = distance(corners[3], corners[0]);
  const ratio = (a: number, b: number) => Math.max(a, b) / Math.min(a, b);
  const limit = OMR_SETTINGS.quad.maxOppositeSideRatio;
  if (ratio(top, bottom) > limit || ratio(left, right) > limit) return 'PERSPECTIVE_UNRELIABLE';
  return null;
}

/**
 * Whether each corner blob is as large as a marker should be where it is.
 * The outline of the four corners fixes how big a 9 mm square appears at each
 * of them, whichever way the sheet is turned.
 */
function cornersAreMarkers(corners: Blob[], template: SheetTemplate): boolean {
  const toImage = homographyFromPoints(template.markers, corners);
  if (!toImage) return false;
  const half = template.markerSize / 2;
  const { minAreaMatch, maxAreaMatch } = OMR_SETTINGS.marker;
  return corners.every((blob, index) => {
    const center = template.markers[index];
    const outline = [
      { x: center.x - half, y: center.y - half },
      { x: center.x + half, y: center.y - half },
      { x: center.x + half, y: center.y + half },
      { x: center.x - half, y: center.y + half },
    ].map((point) => applyHomography(toImage, point));
    const expected =
      (Math.abs(cross(outline[0], outline[1], outline[2])) +
        Math.abs(cross(outline[0], outline[2], outline[3]))) /
      2;
    const match = blob.area / expected;
    return match >= minAreaMatch && match <= maxAreaMatch;
  });
}

// ---------------------------------------------------------------------------
// Reading through a homography
// ---------------------------------------------------------------------------

/** Brightness at a position between pixels, blended from its four neighbours. */
function sample(image: GrayImage, x: number, y: number): number {
  const { width, height, data } = image;
  const cx = Math.min(width - 1.001, Math.max(0, x));
  const cy = Math.min(height - 1.001, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const index = y0 * width + x0;
  const top = data[index] * (1 - fx) + data[index + 1] * fx;
  const bottom = data[index + width] * (1 - fx) + data[index + width + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * How dark a square cell of the sheet is in the photo, from 0 (paper) to 1
 * (print), judged against the paper just outside the cell.
 */
function cellDarkness(image: GrayImage, toImage: Homography, center: Point, size: number): number {
  const read = (dx: number, dy: number) => {
    const at = applyHomography(toImage, { x: center.x + dx, y: center.y + dy });
    return sample(image, at.x, at.y);
  };
  // Paper is read above and below the cell only: cells of the identity row
  // have neighbours to the left and right, never above or below.
  const reach = size * 0.95;
  const aside = size * 0.4;
  const paper = median([
    read(0, -reach),
    read(0, reach),
    read(-aside, -reach),
    read(aside, -reach),
    read(-aside, reach),
    read(aside, reach),
  ]);
  if (paper < 1) return 0;
  let dark = 0;
  let count = 0;
  const inner = size * 0.3;
  for (let dy = -inner; dy <= inner + 1e-9; dy += inner / 2) {
    for (let dx = -inner; dx <= inner + 1e-9; dx += inner / 2) {
      count++;
      if (read(dx, dy) < paper * OMR_SETTINGS.marker.darkRatio) dark++;
    }
  }
  return dark / count;
}

type Placement = {
  toImage: Homography;
  quarterTurns: number;
  /** The question count the sheet's identity row spells. */
  sheetQuestionCount: number;
};

/**
 * Finds which way up the sheet is and reads how many questions it was printed
 * for. The four markers alone fit the sheet in four ways (each quarter turn);
 * only one of them puts the orientation square where it is printed and makes
 * the identity row spell a valid count. The markers, the orientation square,
 * and the identity row are in the same place on every sheet, whatever its
 * question count, so they can be read before the count is known.
 */
function placeTemplate(
  image: GrayImage,
  corners: Point[],
  template: SheetTemplate
): Placement | null {
  const { filledAbove, emptyBelow } = OMR_SETTINGS.cell;
  for (let quarterTurns = 0; quarterTurns < 4; quarterTurns++) {
    // Image corner i shows template marker (i + quarterTurns) mod 4.
    const destination = template.markers.map((_, index) => corners[(index + 4 - quarterTurns) % 4]);
    const toImage = homographyFromPoints(template.markers, destination);
    if (!toImage) continue;

    const orientation = template.orientationMarker;
    const upright = cellDarkness(image, toImage, orientation.center, orientation.size);
    const flipped = cellDarkness(
      image,
      toImage,
      rotatedHalfTurn(template, orientation.center),
      orientation.size
    );
    if (upright < filledAbove || flipped > emptyBelow) continue;

    const cells: boolean[] = [];
    for (const cell of template.identity.cells) {
      const darkness = cellDarkness(image, toImage, cell, template.identity.cellSize);
      // A cell that is neither clearly filled nor clearly empty is not guessed.
      if (darkness > emptyBelow && darkness < filledAbove) break;
      cells.push(darkness >= filledAbove);
    }
    if (cells.length !== template.identity.cells.length) continue;
    const sheetQuestionCount = decodeIdentity(cells);
    if (sheetQuestionCount !== null) return { toImage, quarterTurns, sheetQuestionCount };
  }
  return null;
}

/** The sheet as it would look scanned flat and upright, at a fixed resolution. */
function rectify(image: GrayImage, toImage: Homography, template: SheetTemplate): GrayImage {
  const scale = OMR_SETTINGS.pixelsPerMm;
  const width = Math.round(template.page.width * scale);
  const height = Math.round(template.page.height * scale);
  const data = new Uint8Array(width * height);
  const h = toImage;
  for (let v = 0; v < height; v++) {
    const y = (v + 0.5) / scale;
    for (let u = 0; u < width; u++) {
      const x = (u + 0.5) / scale;
      const w = h[6] * x + h[7] * y + h[8];
      data[v * width + u] = sample(
        image,
        (h[0] * x + h[1] * y + h[2]) / w,
        (h[3] * x + h[4] * y + h[5]) / w
      );
    }
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// Measuring the flattened sheet
// ---------------------------------------------------------------------------

/** Mean brightness of a square patch of the flattened sheet, given in millimetres. */
function patchMean(sheet: GrayImage, center: Point, halfSize: number): number {
  const scale = OMR_SETTINGS.pixelsPerMm;
  const x0 = Math.max(0, Math.round((center.x - halfSize) * scale));
  const x1 = Math.min(sheet.width - 1, Math.round((center.x + halfSize) * scale));
  const y0 = Math.max(0, Math.round((center.y - halfSize) * scale));
  const y1 = Math.min(sheet.height - 1, Math.round((center.y + halfSize) * scale));
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      sum += sheet.data[y * sheet.width + x];
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * How crisp the flattened sheet is: the average strength of the edges around
 * the four corner markers, divided by the difference between paper and print
 * so that a dim photo is not mistaken for a blurred one.
 *
 * It is measured at the markers, not over the whole page, because they are
 * printed the same on every sheet: a sheet with 5 questions has far less
 * print than one with 100 and must not look blurred for that reason.
 */
function sharpness(sheet: GrayImage, contrast: number, template: SheetTemplate): number {
  const { width, height, data } = sheet;
  const scale = OMR_SETTINGS.pixelsPerMm;
  // A window twice the marker's side: the marker and the quiet paper around it.
  const reach = Math.round(template.markerSize * scale);
  let sum = 0;
  let count = 0;
  for (const marker of template.markers) {
    const cx = Math.round(marker.x * scale);
    const cy = Math.round(marker.y * scale);
    const x0 = Math.max(1, cx - reach);
    const x1 = Math.min(width - 2, cx + reach);
    const y0 = Math.max(1, cy - reach);
    const y1 = Math.min(height - 2, cy + reach);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const index = y * width + x;
        const laplacian =
          4 * data[index] - data[index - 1] - data[index + 1] - data[index - width] - data[index + width];
        sum += laplacian * laplacian;
        count++;
      }
    }
  }
  return count === 0 ? 0 : Math.sqrt(sum / count) / contrast / 4;
}

/** The fill of one bubble: the share of its middle that is ink, from 0 to 1. */
function bubbleFill(sheet: GrayImage, center: Point, radiusMm: number): number {
  const scale = OMR_SETTINGS.pixelsPerMm;
  const { innerRadiusShare, paperBandInner, paperBandOuter, inkStart, inkFull } =
    OMR_SETTINGS.bubble;
  const cx = center.x * scale;
  const cy = center.y * scale;
  const radius = radiusMm * scale;
  const outer = radius * paperBandOuter;
  const bandInner2 = (radius * paperBandInner) ** 2;
  const outer2 = outer ** 2;
  const inner2 = (radius * innerRadiusShare) ** 2;

  const paperSamples: number[] = [];
  const inkSamples: number[] = [];
  const x0 = Math.max(0, Math.floor(cx - outer));
  const x1 = Math.min(sheet.width - 1, Math.ceil(cx + outer));
  const y0 = Math.max(0, Math.floor(cy - outer));
  const y1 = Math.min(sheet.height - 1, Math.ceil(cy + outer));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      const value = sheet.data[y * sheet.width + x];
      if (d2 <= inner2) inkSamples.push(value);
      else if (d2 >= bandInner2 && d2 <= outer2) paperSamples.push(value);
    }
  }
  if (inkSamples.length === 0 || paperSamples.length === 0) return 0;

  // The brighter part of the band is paper even if a stray line crosses it.
  paperSamples.sort((a, b) => a - b);
  const paper = paperSamples[Math.floor(paperSamples.length * 0.75)];
  if (paper < 1) return 0;

  const start = paper * inkStart;
  const full = paper * inkFull;
  let ink = 0;
  for (const value of inkSamples) {
    if (value <= full) ink += 1;
    else if (value < start) ink += (start - value) / (start - full);
  }
  return ink / inkSamples.length;
}

// ---------------------------------------------------------------------------
// The whole reading
// ---------------------------------------------------------------------------

/**
 * Reads one photo against the template of the sheet that is expected. A sheet
 * printed for another number of questions is refused, never read with the
 * wrong geometry.
 */
export function readSheet(image: GrayImage, template: SheetTemplate): OmrOutcome {
  const diagnostics: OmrDiagnostics = {};
  const refuse = (problem: CaptureProblem): OmrOutcome => ({ ok: false, problem, diagnostics });

  if (Math.min(image.width, image.height) < OMR_SETTINGS.minShortSide) {
    return refuse('IMAGE_TOO_SMALL');
  }

  // 1. Dark blobs, on a smaller copy.
  const factor = Math.max(1, Math.floor(image.width / OMR_SETTINGS.searchWidth));
  const small = shrink(image, factor);
  const blobs = findBlobs(darkMask(small), small.width, small.height);
  const candidates = markerCandidates(blobs, small.width);
  diagnostics.markerCandidates = candidates.length;

  // 2. The four corner markers, back in the photo's own pixels.
  const picked = pickCorners(candidates);
  if (!picked || !cornersAreMarkers(picked, template)) return refuse('MARKERS_NOT_FOUND');
  const corners = picked.map((blob) => ({
    x: (blob.x + 0.5) * factor - 0.5,
    y: (blob.y + 0.5) * factor - 0.5,
  }));
  const quadProblem = checkQuad(corners, image);
  if (quadProblem) return refuse(quadProblem);

  // 3. Which way up, is it our sheet, and is it the sheet for this question count?
  const placement = placeTemplate(image, corners, template);
  if (!placement) return refuse('UNSUPPORTED_TEMPLATE');
  diagnostics.quarterTurns = placement.quarterTurns;
  if (placement.sheetQuestionCount !== template.questionCount) {
    return {
      ok: false,
      problem: 'WRONG_SHEET',
      sheetQuestionCount: placement.sheetQuestionCount,
      diagnostics,
    };
  }

  // 4. Flatten it.
  const sheet = rectify(image, placement.toImage, template);

  // 5. Can it be trusted? Light first, then focus.
  const inkBrightness =
    template.markers.reduce(
      (sum, marker) => sum + patchMean(sheet, marker, template.markerSize * 0.3),
      0
    ) / template.markers.length;
  // Paper is sampled in the quiet zone beside each marker, toward the page centre.
  const paperBrightness = median(
    template.markers.map((marker) =>
      patchMean(
        sheet,
        {
          x: marker.x,
          y: marker.y + (marker.y < template.page.height / 2 ? 1 : -1) * template.markerSize * 1.1,
        },
        1.5
      )
    )
  );
  diagnostics.paperBrightness = paperBrightness;
  diagnostics.inkBrightness = inkBrightness;
  const contrast = paperBrightness - inkBrightness;
  if (
    paperBrightness < OMR_SETTINGS.lighting.minPaperBrightness ||
    contrast < OMR_SETTINGS.lighting.minContrast
  ) {
    return refuse('BAD_LIGHTING');
  }
  diagnostics.sharpness = sharpness(sheet, contrast, template);
  if (diagnostics.sharpness < OMR_SETTINGS.minSharpness) return refuse('TOO_BLURRY');

  // 6. Every bubble, at its printed place.
  const detections: QuestionDetection[] = [];
  for (let questionNumber = 1; questionNumber <= template.questionCount; questionNumber++) {
    const fills = ANSWER_CHOICES.map((choice) =>
      bubbleFill(sheet, bubbleCenter(template, questionNumber, choice), template.bubbleRadius)
    ) as unknown as BubbleFills;
    detections.push(classifyQuestion(questionNumber, fills));
  }

  return {
    ok: true,
    templateId: template.id,
    detections,
    rectified: sheet,
    pixelsPerMm: OMR_SETTINGS.pixelsPerMm,
    diagnostics,
  };
}
