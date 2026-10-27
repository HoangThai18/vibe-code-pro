// apps/api/src/imports/csv-field.ts — use for the error report and every other CSV export
// OWASP CSV injection: a spreadsheet runs a cell starting with one of these as a formula
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/;

// Quote every field, double inner quotes, prefix ' to formula starters
export function csvField(value: string): string {
  return `"${(FORMULA_START.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
}
