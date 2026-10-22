/** Quote a CSV cell and neutralize values that spreadsheet apps may evaluate. */
export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const isPlainNumber = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim());
  const neutralized = !isPlainNumber && /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
