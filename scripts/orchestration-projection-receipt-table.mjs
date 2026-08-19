// Responsibility: Render validated orchestration receipt records as deterministic raw JSON for Multi-dimensional Table.

export function renderRawReceiptProjection(records = []) {
  const sourceRecords = Array.isArray(records) ? records : [];
  const orderedRecords = [...sourceRecords].sort((left, right) => String(left?.schema || "").localeCompare(String(right?.schema || "")));
  return JSON.stringify(orderedRecords, null, 2) + "\n";
}
