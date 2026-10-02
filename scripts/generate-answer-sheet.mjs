// Writes the printable answer sheet for a number of questions to a PDF file,
// with the same builder the app uses on the phone. For looking at a sheet on
// a computer; the app does not ship any of these files.
//
//   npm run sheet -- 10            writes .expo/sheets/answer-sheet-10.pdf
//   npm run sheet -- 10 out.pdf    writes out.pdf
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildAnswerSheetPdf } from '../src/features/scan/domain/sheet-pdf.ts';
import { sheetTemplate } from '../src/features/scan/domain/template.ts';

const count = Number(process.argv[2]);
if (!Number.isInteger(count)) {
  console.error('Usage: npm run sheet -- <number of questions> [output.pdf]');
  process.exit(1);
}
const target = resolve(process.argv[3] ?? `.expo/sheets/answer-sheet-${count}.pdf`);
mkdirSync(dirname(target), { recursive: true });
const pdf = buildAnswerSheetPdf(sheetTemplate(count));
writeFileSync(target, pdf);
console.log(`Wrote ${target} (${pdf.length} bytes)`);
