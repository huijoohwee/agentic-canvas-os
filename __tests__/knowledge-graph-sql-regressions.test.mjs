import assert from "node:assert/strict";
import test from "node:test";

import { parseSql } from "../src/knowledge-graph/sql-parser.js";

test("SQL names conditional views and indexes and retains constraint facts", () => {
  const result = parseSql({
    path: "schema.sql",
    source: [
      "CREATE TABLE thing (",
      "  id INTEGER PRIMARY KEY,",
      "  code TEXT UNIQUE NOT NULL,",
      "  CONSTRAINT thing_positive CHECK (id > 0)",
      ");",
      "CREATE VIEW IF NOT EXISTS active_thing AS SELECT * FROM thing;",
      "CREATE INDEX IF NOT EXISTS idx_thing_code ON thing(code);",
      "",
    ].join("\n"),
  });

  assert.ok(result.entities.some((entity) => entity.kind === "view" && entity.name === "active_thing"));
  assert.ok(result.entities.some((entity) => entity.kind === "index" && entity.name === "idx_thing_code"));
  const constraints = result.entities.filter((entity) => entity.kind === "constraint");
  assert.ok(constraints.some((entity) => entity.properties.constraintType === "primary-key"));
  assert.ok(constraints.some((entity) => entity.properties.constraintType === "unique"));
  assert.ok(constraints.some((entity) => entity.properties.constraintType === "not-null"));
  assert.ok(constraints.some((entity) => (
    entity.name === "thing_positive" && entity.properties.constraintType === "check"
  )));
  const code = result.entities.find((entity) => entity.kind === "column" && entity.name === "thing.code");
  assert.deepEqual(code.properties.constraints, ["unique", "not-null"]);
});
