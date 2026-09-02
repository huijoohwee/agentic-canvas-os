import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ABSENT_FIELD,
  ABSENT_PRIORITY,
  BEGIN_MARKER,
  BOARD_COLUMNS,
  END_MARKER,
  KANBAN_DOCS_PATH,
  PROJECTED_STATUS,
  PROJECTED_TYPE,
  collectProjectedRows,
  projectLedgerRow,
  renderProjection,
  replaceProjectionBlock,
  validateKanbanProjection,
} from "../scripts/kanban-projection.mjs";

const boardText = () => readFile(new URL(`../docs/${KANBAN_DOCS_PATH}`, import.meta.url), "utf8");
const boardDocuments = async () => new Map([[KANBAN_DOCS_PATH, await boardText()]]);

test("the committed board matches the regenerated ledger projection", async () => {
  assert.deepEqual(validateKanbanProjection(await boardDocuments()), []);
});

test("the projection covers every active-period ledger record exactly once", async () => {
  const { rows, period, failures } = collectProjectedRows();
  assert.deepEqual(failures, []);
  assert.match(period, /^\d{4}-(?:0[1-9]|1[0-2])$/);
  assert.ok(rows.length > 1, "the board must project more than the single authored row");
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  for (const row of rows) {
    assert.equal(row.context_refs, `\`todo/${period}/${row.id}.md\``);
  }
});

test("every projected cell is either recorded or a declared absent value", async () => {
  const { rows } = collectProjectedRows();
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), [...BOARD_COLUMNS]);
    assert.equal(row.type, PROJECTED_TYPE);
    assert.equal(row.status, PROJECTED_STATUS);
    // The ledger records no priority, owner, worker, or target, so the
    // projection must not manufacture one.
    assert.equal(row.priority, ABSENT_PRIORITY);
    assert.equal(row.owner_profile, ABSENT_FIELD);
    assert.equal(row.worker_process, ABSENT_FIELD);
    assert.equal(row.target_profile, ABSENT_FIELD);
    for (const column of ["acceptance", "evidence", "next_action"]) {
      assert.notEqual(row[column].trim(), "");
      assert.ok(!row[column].includes("|"), `${row.id} ${column} must not break the table`);
    }
  }
});

test("cells map to the recorded Output, Decision Logic, and Next Step columns", () => {
  const cells = [
    "sample-context", "intent", "directive", "module", "class", "function",
    "input", "recorded output", "recorded decision logic", "recorded next step",
    "2026-08-01",
  ];
  const row = projectLedgerRow({
    context: "sample-context",
    source: "todo/2026-08/sample-context.md",
    cells,
  });
  assert.equal(row.id, "sample-context");
  assert.equal(row.acceptance, "recorded output");
  assert.equal(row.evidence, "recorded decision logic");
  assert.equal(row.next_action, "recorded next step");
  assert.equal(row.context_refs, "`todo/2026-08/sample-context.md`");
});

test("the rendered block is fenced, digest-stamped, and priority-aligned", () => {
  const { block, digest } = renderProjection({
    rows: [projectLedgerRow({
      context: "a-context",
      source: "todo/2026-08/a-context.md",
      cells: ["a-context", "i", "d", "m", "c", "f", "in", "out", "logic", "next", "2026-08-01"],
    })],
    period: "2026-08",
  });
  assert.ok(block.startsWith(`${BEGIN_MARKER} period=2026-08 rows=1 digest=${digest} -->`));
  assert.ok(block.endsWith(END_MARKER));
  assert.match(block, /\|---\|---\|---\|---:\|/);
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("a hand edit inside the fence fails closed", async () => {
  const text = await boardText();
  const tampered = text.replace(/^\| ([a-z0-9-]+) \| task \| review \|/m, "| $1 | task | done |");
  assert.notEqual(tampered, text, "the fixture must contain a projected row");
  const failures = validateKanbanProjection(new Map([[KANBAN_DOCS_PATH, tampered]]));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /drifted from the immutable ledger/);
  assert.match(failures[0], /npm run kanban:project/);
});

test("a stale declared row count or digest fails closed", async () => {
  const text = await boardText();
  for (const [pattern, replacement, expected] of [
    [/^projection_row_count: \d+$/m, "projection_row_count: 1", "projection_row_count"],
    [/^projection_digest: ".*"$/m, `projection_digest: "${"0".repeat(64)}"`, "projection_digest"],
    [/^projection_period: ".*"$/m, 'projection_period: "1999-01"', "projection_period"],
  ]) {
    const failures = validateKanbanProjection(
      new Map([[KANBAN_DOCS_PATH, text.replace(pattern, replacement)]]),
    );
    assert.ok(
      failures.some((failure) => failure.includes(expected)),
      `${expected} drift must fail closed`,
    );
  }
});

test("missing fence markers fail closed rather than silently skipping", async () => {
  const text = await boardText();
  const stripped = text.slice(0, text.indexOf(BEGIN_MARKER))
    + text.slice(text.indexOf(END_MARKER) + END_MARKER.length);
  const failures = validateKanbanProjection(new Map([[KANBAN_DOCS_PATH, stripped]]));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /fence markers are missing or out of order/);
  assert.equal(replaceProjectionBlock(stripped, "block"), null);
});

test("authored rows keep the full status vocabulary and stay outside the fence", async () => {
  const text = await boardText();
  const authored = text.slice(0, text.indexOf(BEGIN_MARKER));
  assert.match(authored, /^\| KANBAN-0001 \| task \| ready \| 1 \| operator \|/m);
  const projected = text.slice(text.indexOf(BEGIN_MARKER));
  assert.ok(!projected.includes("KANBAN-"), "authored ids must not appear inside the fence");
});

test("legacy monthly shards are not projected", async () => {
  const text = await boardText();
  const projected = text.slice(text.indexOf(BEGIN_MARKER), text.indexOf(END_MARKER));
  const { period } = collectProjectedRows();
  assert.ok(!/`todo\/\d{4}-\d{2}\.md`/.test(projected), "legacy shard rows must stay history");
  assert.ok(projected.includes(`todo/${period}/`));
});
