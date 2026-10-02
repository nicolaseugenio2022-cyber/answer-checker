// Draws the app's icon, Android adaptive icon layers, splash image, and
// favicon, and writes them to assets/images. The artwork is original to this
// project: three answer bubbles in a row, the middle one filled and checked,
// in the app's pink. Nothing is downloaded and no image library is used; the
// PNG files are written with Node's own zlib.
//
//   npm run brand
//
// Edit the shapes or the colors here and run it again; do not edit the PNG
// files by hand.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/images');

/** The primary pink of the light theme: hsl(333 76% 42%) in src/global.css. */
const PINK = [188, 26, 99];
const WHITE = [255, 255, 255];

// --- PNG ---------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** An 8-bit RGBA PNG from `size * size * 4` bytes. */
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Shapes, in a unit square: (0, 0) top left to (1, 1) bottom right -----------

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inRing = (x, y, cx, cy, r, stroke) => inCircle(x, y, cx, cy, r) && !inCircle(x, y, cx, cy, r - stroke);
/** A line with round ends. */
function inStroke(x, y, x0, y0, x1, y1, halfWidth) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return (x - x0 - t * dx) ** 2 + (y - y0 - t * dy) ** 2 <= halfWidth * halfWidth;
}
function inRoundedSquare(x, y, radius) {
  const qx = Math.abs(x - 0.5) - (0.5 - radius);
  const qy = Math.abs(y - 0.5) - (0.5 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= radius;
}

/**
 * The mark: an empty bubble, a filled and checked bubble, an empty bubble.
 * `scale` is its width as a share of the canvas. Returns 'mark' for the
 * bubbles, 'check' for the check inside the middle one, or null.
 */
function markAt(x, y, scale) {
  // In the mark's own coordinates: 3 units wide, centred on the canvas.
  const u = (x - 0.5) / scale;
  const v = (y - 0.5) / scale;
  const r = 0.14;
  const gap = 0.34;
  if (inStroke(u, v, -0.062, 0.004, -0.018, 0.05, 0.026) || inStroke(u, v, -0.018, 0.05, 0.07, -0.05, 0.026)) {
    return inCircle(u, v, 0, 0, r) ? 'check' : null;
  }
  if (inCircle(u, v, 0, 0, r)) return 'mark';
  if (inRing(u, v, -gap, 0, r, 0.034) || inRing(u, v, gap, 0, r, 0.034)) return 'mark';
  return null;
}

/**
 * Renders `size` pixels square. `colorAt(x, y)` returns [r, g, b, a] (0-255)
 * for a point of the unit square; each pixel is the average of 4 x 4 points.
 */
function render(size, colorAt) {
  const rgba = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const [cr, cg, cb, ca] = colorAt((px + (sx + 0.5) / N) / size, (py + (sy + 0.5) / N) / size);
          // Colour is weighted by alpha so edges do not darken.
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const index = (py * size + px) * 4;
      rgba[index] = a === 0 ? 0 : Math.round(r / a);
      rgba[index + 1] = a === 0 ? 0 : Math.round(g / a);
      rgba[index + 2] = a === 0 ? 0 : Math.round(b / a);
      rgba[index + 3] = Math.round(a / (N * N));
    }
  }
  return png(size, rgba);
}

const CLEAR = [0, 0, 0, 0];
const solid = (color) => [...color, 255];

/** White mark on pink; the check shows the pink through the middle bubble. */
const onPink = (scale) => (x, y) => {
  const part = markAt(x, y, scale);
  return solid(part === 'mark' ? WHITE : PINK);
};

const ASSETS = {
  // The full icon, square: launchers and stores round it themselves.
  'icon.png': [1024, onPink(0.86)],
  // Adaptive icon: the mark sits inside the centre two thirds, which every mask shows.
  'android-icon-foreground.png': [
    1024,
    (x, y) => {
      const part = markAt(x, y, 0.56);
      return part === 'mark' ? solid(WHITE) : part === 'check' ? solid(PINK) : CLEAR;
    },
  ],
  'android-icon-background.png': [1024, () => solid(PINK)],
  // Themed icons: one colour, the check cut out.
  'android-icon-monochrome.png': [
    1024,
    (x, y) => (markAt(x, y, 0.56) === 'mark' ? solid(WHITE) : CLEAR),
  ],
  // Splash and favicon: the icon as a rounded tile on a transparent ground.
  'splash-icon.png': [
    384,
    (x, y) => (inRoundedSquare(x, y, 0.22) ? onPink(0.86)(x, y) : CLEAR),
  ],
  'favicon.png': [48, (x, y) => (inRoundedSquare(x, y, 0.22) ? onPink(0.86)(x, y) : CLEAR)],
};

mkdirSync(OUT, { recursive: true });
for (const [name, [size, colorAt]] of Object.entries(ASSETS)) {
  const file = render(size, colorAt);
  writeFileSync(resolve(OUT, name), file);
  console.log(`${name}  ${size} x ${size}  ${file.length} bytes`);
}
