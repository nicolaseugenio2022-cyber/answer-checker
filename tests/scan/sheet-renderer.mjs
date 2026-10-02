// Draws the project's own answer sheet and "photographs" it, so the reader can
// be tested against pictures whose true content is known. Everything is
// generated from the same template geometry the reader and the PDF use; no
// third-party sheet or image is involved.
import { ANSWER_CHOICES } from '../../src/features/answer-keys/domain/answer-key.ts';
import {
  bubbleCenter,
  columnHeaderAnchors,
  questionLabelAnchor,
} from '../../src/features/scan/domain/template.ts';
import {
  applyHomography,
  homographyFromPoints,
} from '../../src/features/scan/infrastructure/omr/homography.ts';

const PAPER = 238;
const INK = 28;

/** A small deterministic random source, so a test image is the same on every run. */
export function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The flat sheet at `scale` pixels per millimetre.
 *
 * `marks` maps a question number to what is drawn in its bubbles: a letter
 * ("B"), several letters ("AC"), or an object { A: 0.4 } giving each bubble a
 * darkness from 0 (untouched) to 1 (fully shaded with dark ink).
 *
 * `omit` leaves parts out: 'orientation', 'identity', or a marker index 0-3.
 */
export function drawSheet(template, marks = {}, { scale = 6, omit = [], identity } = {}) {
  const width = Math.round(template.page.width * scale);
  const height = Math.round(template.page.height * scale);
  const data = new Uint8Array(width * height).fill(PAPER);

  const blend = (x, y, value, coverage) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    data[index] = Math.round(data[index] * (1 - coverage) + value * coverage);
  };
  const square = (center, size, value = INK) => {
    const x0 = Math.round((center.x - size / 2) * scale);
    const x1 = Math.round((center.x + size / 2) * scale);
    const y0 = Math.round((center.y - size / 2) * scale);
    const y1 = Math.round((center.y + size / 2) * scale);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) blend(x, y, value, 1);
  };
  /** A disc, or a ring when `inner` is given. Radii in millimetres. */
  const disc = (center, radius, value, coverage = 1, inner = 0) => {
    const cx = center.x * scale;
    const cy = center.y * scale;
    const r = radius * scale;
    const ri = inner * scale;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        // One pixel of soft edge, like a printed or pencilled outline.
        const outerEdge = Math.min(1, Math.max(0, r - d + 0.5));
        const innerEdge = ri > 0 ? Math.min(1, Math.max(0, d - ri + 0.5)) : 1;
        const amount = outerEdge * innerEdge * coverage;
        if (amount > 0) blend(x, y, value, amount);
      }
    }
  };

  template.markers.forEach((marker, index) => {
    if (!omit.includes(index)) square(marker, template.markerSize);
  });
  if (!omit.includes('orientation')) {
    square(template.orientationMarker.center, template.orientationMarker.size);
  }
  if (!omit.includes('identity')) {
    const pattern = identity ?? template.identity.pattern;
    template.identity.cells.forEach((cell, index) => {
      if (pattern[index]) square(cell, template.identity.cellSize);
    });
  }

  // Stand-ins for printed text: thin bars where the header fields, the column
  // letters, and the question numbers are. They are there to prove the reader
  // is not confused by print that is not a bubble.
  const bar = (x0, x1, y, thickness, value = INK) => {
    for (let py = Math.round(y * scale); py < Math.round((y + thickness) * scale); py++) {
      for (let px = Math.round(x0 * scale); px < Math.round(x1 * scale); px++) blend(px, py, value, 1);
    }
  };
  for (const y of [38, 48, 58, 68]) {
    bar(30, 52, y - 3, 2.2); // a field label
    bar(56, 180, y, 0.3); // the line to write on
  }
  bar(60, 150, 24, 4); // the sheet title
  for (const header of columnHeaderAnchors(template)) square(header.at, 2.4);
  for (let question = 1; question <= template.questionCount; question++) {
    const anchor = questionLabelAnchor(template, question);
    square({ x: anchor.x - 1.3, y: anchor.y }, 2.4);
  }

  for (let question = 1; question <= template.questionCount; question++) {
    const mark = marks[question];
    for (const choice of ANSWER_CHOICES) {
      const center = bubbleCenter(template, question, choice);
      disc(center, template.bubbleRadius, INK, 1, template.bubbleRadius - 0.35);
      let darkness = 0;
      if (typeof mark === 'string') darkness = mark.includes(choice) ? 1 : 0;
      else if (mark && typeof mark === 'object') darkness = mark[choice] ?? 0;
      if (darkness > 0) {
        // A shaded bubble is not printer-black: full pencil is a dark gray.
        const value = PAPER - (PAPER - 55) * darkness;
        disc(center, template.bubbleRadius - 0.2, value, 1);
      }
    }
  }
  return { width, height, data, scale };
}

function sampleBilinear(image, x, y, outside) {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return outside;
  const x0 = Math.min(image.width - 2, Math.floor(x));
  const y0 = Math.min(image.height - 2, Math.floor(y));
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * image.width + x0;
  const top = image.data[i] * (1 - fx) + image.data[i + 1] * fx;
  const bottom = image.data[i + image.width] * (1 - fx) + image.data[i + image.width + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Averages every pixel with its neighbours within `radius`, twice: a soft, camera-like blur. */
export function blur(image, radius) {
  if (radius <= 0) return image;
  let source = Float32Array.from(image.data);
  const { width, height } = image;
  for (let pass = 0; pass < 2; pass++) {
    for (const horizontal of [true, false]) {
      const target = new Float32Array(source.length);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0;
          let count = 0;
          for (let d = -radius; d <= radius; d++) {
            const xx = horizontal ? x + d : x;
            const yy = horizontal ? y : y + d;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            sum += source[yy * width + xx];
            count++;
          }
          target[y * width + x] = sum / count;
        }
      }
      source = target;
    }
  }
  return { width, height, data: Uint8Array.from(source, (value) => Math.round(value)) };
}

/**
 * A photo of the sheet lying on a desk.
 *
 * - `corners`: where the page's four corners (top left, top right, bottom
 *   right, bottom left) land in the photo, as fractions of its width and
 *   height. Defaults to a page that fills most of the frame, squarely.
 * - `halfTurn`: the sheet lies upside down.
 * - `quarterTurns`: the sheet is turned by that many right angles.
 * - `light`: a function of the photo position (0..1, 0..1) giving a brightness
 *   factor, for shadow and uneven light.
 * - `noise`: random gray levels added to every pixel.
 * - `blurRadius`: camera blur in photo pixels.
 */
export function photograph(page, template, options = {}) {
  const {
    width = 1200,
    height = 1600,
    corners = [
      [0.06, 0.05],
      [0.94, 0.05],
      [0.94, 0.95],
      [0.06, 0.95],
    ],
    quarterTurns = 0,
    desk = 96,
    light = () => 1,
    noise = 0,
    blurRadius = 0,
    seed = 7,
  } = options;

  const photoCorners = corners.map(([x, y]) => ({ x: x * width, y: y * height }));
  const pageCorners = [
    { x: 0, y: 0 },
    { x: template.page.width, y: 0 },
    { x: template.page.width, y: template.page.height },
    { x: 0, y: template.page.height },
  ];
  // Turning the sheet moves each page corner to the next photo corner.
  const turned = pageCorners.map((_, index) => pageCorners[(index + quarterTurns) % 4]);
  const toPage = homographyFromPoints(photoCorners, turned);

  const random = seeded(seed);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = applyHomography(toPage, { x: x + 0.5, y: y + 0.5 });
      const inside =
        at.x >= 0 && at.y >= 0 && at.x <= template.page.width && at.y <= template.page.height;
      let value = inside
        ? sampleBilinear(page, at.x * page.scale - 0.5, at.y * page.scale - 0.5, PAPER)
        : desk;
      value *= light(x / width, y / height);
      if (noise > 0) value += (random() - 0.5) * 2 * noise;
      data[y * width + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return blur({ width, height, data }, blurRadius);
}
