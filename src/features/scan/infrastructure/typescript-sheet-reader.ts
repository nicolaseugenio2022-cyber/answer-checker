import type { SheetReader } from '../application/scan-ports';
import { readSheet } from './omr/read-sheet';

/**
 * The sheet reader the app uses: the project's own image processing in
 * TypeScript (see omr/read-sheet.ts). It runs on the device, needs no native
 * module, and is the same code the tests run against generated sheets.
 */
export const typescriptSheetReader: SheetReader = {
  read(image, template) {
    const outcome = readSheet(image, template);
    if (!outcome.ok) {
      return {
        ok: false,
        problem: outcome.problem,
        sheetQuestionCount: outcome.sheetQuestionCount,
      };
    }
    return {
      ok: true,
      templateId: outcome.templateId,
      detections: outcome.detections,
      rectified: outcome.rectified,
    };
  },
};
