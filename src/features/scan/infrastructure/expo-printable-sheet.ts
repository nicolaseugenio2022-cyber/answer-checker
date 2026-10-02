import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { PrintableSheet } from '../application/scan-ports';

/** Earlier sheets written for sharing have names that start like this. */
const FILE_PREFIX = 'Answer sheet - ';

/**
 * Writes a generated answer sheet PDF to the app's cache and hands it to
 * Android's share sheet, from which the Teacher can open it in a PDF viewer,
 * print it, or send it to another device. The PDF is made on the phone;
 * nothing is downloaded from the internet.
 */
export const expoPrintableSheet: PrintableSheet = {
  async share(pdf, fileName) {
    if (!(await Sharing.isAvailableAsync())) return false;

    // Only the newest sheet is kept: sheets shared earlier are removed first.
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && entry.name.startsWith(FILE_PREFIX)) entry.delete();
    }
    const file = new File(Paths.cache, fileName);
    file.create();
    file.write(pdf);

    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Answer Checker answer sheet',
      UTI: 'com.adobe.pdf',
    });
    return true;
  },
};
