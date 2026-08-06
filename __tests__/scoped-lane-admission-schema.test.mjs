import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

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
    ["active", "review_ready", "parked", "delivery_authorized", "waiting-successor"],
  );
  assert.equal(validate("delivery_authorized"), true);
  assert.equal(validate("waiting-successor"), true);
  assert.equal(validate("delivery-authorized"), false);
});

test("local cloud authority remains limited to authoring states", () => {
  const validate = new Ajv2020({ strict: false }).compile(localCloudStateSchema);

  assert.deepEqual(localCloudStateSchema.enum, ["active", "review_ready"]);
  assert.equal(validate("active"), true);
  assert.equal(validate("review_ready"), true);
  assert.equal(validate("delivery_authorized"), false);
});

test("root-source bootstrap operator decision is exact and digest-shaped", () => {
  const decisionSchema = {
    ...schema.$defs.rootSourceBootstrapOperatorDecision,
    $defs: { digest: schema.$defs.digest },
  };
  const validate = new Ajv2020({ strict: false }).compile(decisionSchema);
  const core = {
    schema: "agentic-root-source-bootstrap-operator-decision/v1",
    operation: "root-source-bootstrap-exception",
    authorizationToken: "AUTHORIZE ROOT-SOURCE BOOTSTRAP EXCEPTION",
    explicit: true,
    approved: true,
    actorId: "github-user:8945812",
    candidateClaimId: "1".repeat(64),
    maintenanceWorktreeCount: 1,
    maintenanceIsolation: "required",
    allowedMaintenanceChanges: ["focused-tests", "reclaim-admission-owners"],
    preservationPolicy: "all-existing-lanes-and-bytes",
    requiredSuccessor: "normal-cloud-authoritative-admitted-lane",
    forbiddenOperations: [
      "cleanup",
      "deployment",
      "manual-ledger-edit",
      "manual-registry-edit",
      "merge",
    ],
  };
  const decision = { ...core, decisionDigest: digestValue(core) };
  assert.equal(validate(decision), true, JSON.stringify(validate.errors));
  for (const invalid of [
    { ...decision, authorizationToken: "AUTHORIZE" },
    { ...decision, approved: false },
    { ...decision, maintenanceWorktreeCount: 2 },
    { ...decision, forbiddenOperations: ["merge"] },
    { ...decision, unexpected: true },
  ]) {
    assert.equal(validate(invalid), false);
  }
});
