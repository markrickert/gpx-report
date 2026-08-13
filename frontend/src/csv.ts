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

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename, rows, columns) {
  const csv = toCsv(rows, columns);
  triggerDownload(filename, new Blob([csv], { type: "text/csv;charset=utf-8;" }));
}

// Pretty-printed JSON download — used for raw data exports where the
// consumer (Python/Jupyter/etc.) wants the full object shape rather than a
// flattened table.
export function downloadJson(filename, data) {
  const json = JSON.stringify(data, null, 2);
  triggerDownload(filename, new Blob([json], { type: "application/json;charset=utf-8;" }));
}
