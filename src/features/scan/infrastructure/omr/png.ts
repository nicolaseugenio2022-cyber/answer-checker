import { unzlibSync, zlibSync } from 'fflate';

import type { GrayImage } from '../../domain/gray-image';

/**
 * Just enough PNG to move pictures in and out of the reader without a native
 * image library: reading the 8-bit PNG the phone writes after resizing a
 * photo, and writing the flattened sheet as an 8-bit grayscale PNG.
 * Compression is done by fflate; the PNG framing is here.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The file is not a PNG this reader supports. */
export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngError';
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const readUint32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

function writeUint32(bytes: Uint8Array, at: number, value: number) {
  bytes[at] = value >>> 24;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
}

/** Channels per pixel for each PNG color type this reader accepts. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Reads an 8-bit, non-interlaced PNG (gray, gray+alpha, RGB, or RGBA) as brightness. */
export function decodePngToGray(bytes: Uint8Array): GrayImage {
  if (bytes.length < 33 || SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new PngError('Not a PNG file.');
  }

  let width = 0;
  let height = 0;
  let channels = 0;
  const chunks: Uint8Array[] = [];
  let compressedLength = 0;

  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = readUint32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const start = at + 8;
    if (start + length + 4 > bytes.length) throw new PngError('The PNG file is cut short.');
    if (type === 'IHDR') {
      width = readUint32(bytes, start);
      height = readUint32(bytes, start + 4);
      const bitDepth = bytes[start + 8];
      const colorType = bytes[start + 9];
      const interlace = bytes[start + 12];
      channels = CHANNELS[colorType] ?? 0;
      if (bitDepth !== 8 || channels === 0 || interlace !== 0) {
        throw new PngError('Only 8-bit, non-interlaced PNG files without a palette are supported.');
      }
    } else if (type === 'IDAT') {
      chunks.push(bytes.subarray(start, start + length));
      compressedLength += length;
    } else if (type === 'IEND') {
      break;
    }
    at = start + length + 4;
  }
  if (width === 0 || height === 0 || chunks.length === 0) throw new PngError('The PNG file has no image.');

  const compressed = new Uint8Array(compressedLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  let raw: Uint8Array;
  try {
    raw = unzlibSync(compressed);
  } catch {
    throw new PngError('The PNG image data is damaged.');
  }

  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new PngError('The PNG image data is incomplete.');

  // Undo the per-row filters in place, then reduce each pixel to brightness.
  const data = new Uint8Array(width * height);
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    for (let x = 0; x < stride; x++) {
      const value = raw[rowStart + 1 + x];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new PngError('The PNG file uses an unknown row filter.');
      }
      current[x] = (value + predicted) & 0xff;
    }
    const out = y * width;
    if (channels >= 3) {
      for (let x = 0; x < width; x++) {
        const p = x * channels;
        // Rec. 601 luma, in integers.
        data[out + x] = (current[p] * 77 + current[p + 1] * 150 + current[p + 2] * 29) >> 8;
      }
    } else {
      for (let x = 0; x < width; x++) data[out + x] = current[x * channels];
    }
    [previous, current] = [current, previous];
  }
  return { width, height, data };
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 12);
  writeUint32(out, 0, payload.length);
  for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index);
  out.set(payload, 8);
  writeUint32(out, 8 + payload.length, crc32(out, 4, 8 + payload.length));
  return out;
}

/** Writes brightness as an 8-bit grayscale PNG. */
export function encodeGrayToPng(image: GrayImage): Uint8Array {
  const { width, height, data } = image;
  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  // compression, filter, and interlace methods stay 0

  // Each row is stored as its difference from the row above ("Up" filter):
  // a sheet is mostly unchanged from row to row, which compresses well.
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width + 1);
    raw[rowStart] = y === 0 ? 0 : 2;
    for (let x = 0; x < width; x++) {
      const value = data[y * width + x];
      raw[rowStart + 1 + x] = y === 0 ? value : (value - data[(y - 1) * width + x]) & 0xff;
    }
  }

  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
