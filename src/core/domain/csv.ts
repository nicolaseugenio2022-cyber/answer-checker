/**
 * A small CSV reader (RFC 4180): quoted fields, commas and line breaks inside
 * quotes, and "" for a quote inside a quoted field. Pure text in, records out.
 */

export type CsvRecord = {
  /** 1-based line of the file on which the record starts. The header is line 1. */
  line: number;
  fields: string[];
};

export type CsvResult =
  | { ok: true; records: CsvRecord[] }
  /** `line` is where the record that could not be read starts. */
  | { ok: false; line: number; reason: 'UNCLOSED_QUOTE' | 'TEXT_AFTER_QUOTE' };

const BOM = '﻿';

/**
 * Reads every record, including blank ones (a blank line is a record with one
 * empty field); the caller decides what to skip. Accepts LF, CRLF, and CR line
 * endings and a leading UTF-8 byte-order mark.
 */
export function parseCsv(source: string): CsvResult {
  const text = source.startsWith(BOM) ? source.slice(1) : source;
  const records: CsvRecord[] = [];

  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;
  // True right after a closing quote: only a comma or a line break may follow.
  let afterQuote = false;
  // True when the current record has any character, so a final line without a
  // line break is still a record and a trailing line break adds none.
  let hasContent = false;

  const endRecord = () => {
    fields.push(field);
    records.push({ line: recordLine, fields });
    fields = [];
    field = '';
    afterQuote = false;
    hasContent = false;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        if (char === '\n' || (char === '\r' && text[index + 1] !== '\n')) line++;
        field += char;
      }
      continue;
    }

    if (char === ',') {
      fields.push(field);
      field = '';
      afterQuote = false;
      hasContent = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      endRecord();
      line++;
      recordLine = line;
    } else if (afterQuote) {
      return { ok: false, line: recordLine, reason: 'TEXT_AFTER_QUOTE' };
    } else if (char === '"' && field.length === 0) {
      inQuotes = true;
      hasContent = true;
    } else {
      field += char;
      hasContent = true;
    }
  }

  if (inQuotes) return { ok: false, line: recordLine, reason: 'UNCLOSED_QUOTE' };
  if (hasContent) endRecord();

  return { ok: true, records };
}
