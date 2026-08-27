export function parseClipboardTable(text: string) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .filter((row, index, rows) => row.length > 0 || index < rows.length - 1)
    .map((row) => row.split('\t'))
}

export function rowsLookLikeHeader(firstRow: string[], columnNames: string[]) {
  if (firstRow.length < 2) return false
  const normalized = new Set(columnNames.map((name) => name.trim().toLowerCase()))
  const hits = firstRow.filter((cell) => normalized.has(cell.trim().toLowerCase()))
  return hits.length >= Math.min(2, firstRow.length)
}
