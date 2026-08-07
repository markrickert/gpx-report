// Builds a CSV string from an array of row objects and column definitions,
// then triggers a browser download. No server round-trip — the data is
// already loaded client-side via GraphQL.

function escapeCsvField(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// columns: [{ header: string, accessor: (row) => value }]
export function toCsv(rows, columns) {
  const lines = [columns.map((col) => escapeCsvField(col.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCsvField(col.accessor(row))).join(","));
  }
  return lines.join("\r\n");
}

export function downloadCsv(filename, rows, columns) {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
