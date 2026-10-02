import {
  bubbleCenter,
  columnHeaderAnchors,
  questionLabelAnchor,
  type Point,
  type SheetTemplate,
} from './template';

/**
 * Draws the printable answer sheet for a template as a PDF: one A4 page,
 * vector, black only. It is drawn from the same geometry the reader uses, so
 * the paper and the reader cannot drift apart, and it runs on the phone: the
 * sheet for a 10-question answer key is made when the Teacher asks for it.
 *
 * The PDF is written by hand (rectangles, circles, lines, and the two standard
 * Helvetica fonts every PDF reader has), so no PDF library is needed. Pure:
 * a template in, bytes out.
 */

const MM = 72 / 25.4; // PDF points per millimetre

/** Approximate advance width of Helvetica glyphs, in thousandths of the font size. */
function textWidth(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const char of text) {
    if (/[0-9]/.test(char)) units += 556;
    else if (char === ' ') units += 278;
    else if (/[ilI.,:;'|!]/.test(char)) units += bold ? 300 : 250;
    else if (/[mwMW]/.test(char)) units += 860;
    else if (/[A-Z]/.test(char)) units += bold ? 720 : 680;
    else units += bold ? 580 : 540;
  }
  return (units / 1000) * size;
}

type TextOptions = { bold?: boolean; align?: 'left' | 'center' | 'right'; gray?: number };

export function buildAnswerSheetPdf(template: SheetTemplate): Uint8Array {
  const { width, height } = template.page;
  const count = template.questionCount;
  const ops: string[] = [];
  const n = (value: number) => Number(value.toFixed(3));
  // Page coordinates are millimetres from the top left; PDF's are points from the bottom left.
  const px = (x: number) => n(x * MM);
  const py = (y: number) => n((height - y) * MM);

  const fillSquare = (center: Point, size: number) => {
    ops.push(`${px(center.x - size / 2)} ${py(center.y + size / 2)} ${n(size * MM)} ${n(size * MM)} re f`);
  };
  /** A circle as four Bezier arcs. */
  const strokeCircle = (center: Point, radius: number, lineWidth: number) => {
    const k = 0.5522847498 * radius;
    const { x, y } = center;
    ops.push(
      `${n(lineWidth * MM)} w`,
      `${px(x + radius)} ${py(y)} m`,
      `${px(x + radius)} ${py(y - k)} ${px(x + k)} ${py(y - radius)} ${px(x)} ${py(y - radius)} c`,
      `${px(x - k)} ${py(y - radius)} ${px(x - radius)} ${py(y - k)} ${px(x - radius)} ${py(y)} c`,
      `${px(x - radius)} ${py(y + k)} ${px(x - k)} ${py(y + radius)} ${px(x)} ${py(y + radius)} c`,
      `${px(x + k)} ${py(y + radius)} ${px(x + radius)} ${py(y + k)} ${px(x + radius)} ${py(y)} c`,
      'S'
    );
  };
  const line = (x0: number, y0: number, x1: number, y1: number, lineWidth: number) => {
    ops.push(`${n(lineWidth * MM)} w ${px(x0)} ${py(y0)} m ${px(x1)} ${py(y1)} l S`);
  };
  /** Text with its baseline at y. `align` is relative to x. Size in points. */
  const text = (value: string, x: number, y: number, size: number, options: TextOptions = {}) => {
    const { bold = false, align = 'left', gray = 0 } = options;
    const widthMm = textWidth(value, size, bold) / MM;
    const startX = align === 'center' ? x - widthMm / 2 : align === 'right' ? x - widthMm : x;
    const escaped = value.replace(/[\\()]/g, (char) => `\\${char}`);
    ops.push(`${gray} g BT /${bold ? 'F2' : 'F1'} ${size} Tf ${px(startX)} ${py(y)} Td (${escaped}) Tj ET 0 g`);
  };

  ops.push('0 g 0 G');

  // Machine-read parts: nothing else may be printed near them.
  for (const marker of template.markers) fillSquare(marker, template.markerSize);
  fillSquare(template.orientationMarker.center, template.orientationMarker.size);
  template.identity.cells.forEach((cell, index) => {
    if (template.identity.pattern[index]) fillSquare(cell, template.identity.cellSize);
  });

  // Title and the fields a person reads. The app does not read them.
  text('Answer Sheet', width / 2, 27, 17, { bold: true, align: 'center' });
  const fields: [string, number, number, number][] = [
    ['Name', 30, 41, 122],
    ['Student ID', 128, 41, 180],
    ['Subject', 30, 53, 122],
    ['Class', 128, 53, 180],
  ];
  for (const [label, x, y, lineEnd] of fields) {
    text(label, x, y, 9, { bold: true });
    const labelWidth = textWidth(label, 9, true) / MM;
    line(x + labelWidth + 2, y + 0.6, lineEnd, y + 0.6, 0.25);
  }
  text(
    'Handwriting on this sheet is not read by the app. Your teacher selects your name.',
    width / 2,
    62,
    7.5,
    { align: 'center', gray: 0.25 }
  );
  text(
    'Fill one bubble completely for each question. Use a dark pencil or pen. Erase fully to change an answer.',
    width / 2,
    67.5,
    7.5,
    { align: 'center', gray: 0.25 }
  );

  // The answer grid: exactly the questions of the answer key, no spare rows.
  const { labelSize, firstRowY, rowPitch, rowsPerColumn, columnAX, choicePitch } = template.layout;
  // Half the height of a capital letter, to centre text on a row.
  const halfCap = (labelSize * 0.36) / MM;
  for (const header of columnHeaderAnchors(template)) {
    text(header.choice, header.at.x, header.at.y + halfCap, labelSize, { bold: true, align: 'center' });
  }
  for (let question = 1; question <= count; question++) {
    const anchor = questionLabelAnchor(template, question);
    text(String(question), anchor.x, anchor.y + halfCap, labelSize, { bold: true, align: 'right' });
    for (const choice of ['A', 'B', 'C', 'D'] as const) {
      strokeCircle(bubbleCenter(template, question, choice), template.bubbleRadius - 0.175, 0.35);
    }
  }
  // A light rule between neighbouring columns, as long as the longer of the two.
  for (let column = 1; column < columnAX.length; column++) {
    const rowsHere = Math.min(rowsPerColumn, count - (column - 1) * rowsPerColumn);
    const previousEnd = columnAX[column - 1] + 3 * choicePitch + template.bubbleRadius;
    const nextStart = questionLabelAnchor(template, column * rowsPerColumn + 1).x - 6;
    const x = (previousEnd + nextStart) / 2;
    line(x, firstRowY - 6, x, firstRowY + (rowsHere - 1) * rowPitch + 4, 0.15);
  }

  // Footer: kept clear of the place the orientation square would be on an upside-down sheet.
  text(`${count} ${count === 1 ? 'question' : 'questions'}`, 30, 283.6, 9, { bold: true });
  text(
    `${template.id}. Print on A4 in black. Keep all four corner squares visible.`,
    56,
    283.6,
    7,
    { gray: 0.25 }
  );

  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(width * MM)} ${n(height * MM)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    // Every character is ASCII, so the length in bytes is the length in characters.
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (Answer sheet, ${count} questions) /Creator (Answer Checker) >>`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index++) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return bytes;
}
