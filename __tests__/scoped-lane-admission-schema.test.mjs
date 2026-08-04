import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(await readFile(
  new URL("../docs/schemas/scoped-lane-admission-report.v1.schema.json", import.meta.url),
  "utf8",
));
const remoteStateSchema = schema.$defs.remoteClaim.properties.state;
const localCloudStateSchema = schema.$defs.cloudAuthority.properties.state;

test("remote delivery-authorized claims satisfy the report contract", () => {
  const validate = new Ajv2020({ strict: false }).compile(remoteStateSchema);

  assert.deepEqual(
    remoteStateSchema.enum,
    ["active", "review_ready", "parked", "delivery_authorized"],
  );
  assert.equal(validate("delivery_authorized"), true);
  assert.equal(validate("delivery-authorized"), false);
});

test("local cloud authority remains limited to authoring states", () => {
  const validate = new Ajv2020({ strict: false }).compile(localCloudStateSchema);

  assert.deepEqual(localCloudStateSchema.enum, ["active", "review_ready"]);
  assert.equal(validate("active"), true);
  assert.equal(validate("review_ready"), true);
  assert.equal(validate("delivery_authorized"), false);
});
