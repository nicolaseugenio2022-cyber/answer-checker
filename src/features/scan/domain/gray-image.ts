/** A picture as brightness only: one byte per pixel, 0 black to 255 white, row by row. */
export type GrayImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

/**
 * Why a photo cannot be read. Each one tells the Teacher what to change; none
 * of them produces answers or a score.
 */
export type CaptureProblem =
  /** Too few pixels to measure bubbles. */
  | 'IMAGE_TOO_SMALL'
  /** The four corner markers were not all found: the sheet is cropped, covered, or not a sheet. */
  | 'MARKERS_NOT_FOUND'
  /** The sheet is a small part of the picture. */
  | 'SHEET_TOO_SMALL'
  /** The sheet is photographed at too steep an angle to straighten reliably. */
  | 'PERSPECTIVE_UNRELIABLE'
  /** The markers are there, but this is not a sheet the app can read. */
  | 'UNSUPPORTED_TEMPLATE'
  /** An Answer Checker sheet, but printed for a different number of questions than the answer key has. */
  | 'WRONG_SHEET'
  | 'TOO_BLURRY'
  /** Too dark, or too little difference between paper and print: shadow or glare. */
  | 'BAD_LIGHTING';
