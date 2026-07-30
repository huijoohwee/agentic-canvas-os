import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMISSION_ENFORCED_STAGES,
  ADMISSION_FINDING_TYPES,
  ADMISSION_UNEVALUATED_STAGES,
  evaluateAdmissionEvidence,
  verifyAdmissionStageReceipt,
} from "../scripts/agentic-sdlc/admission-evaluator.mjs";
import {
  digestAdmissionValue,
} from "../scripts/agentic-sdlc/admission-evidence.mjs";
import { lifecyclePolicyIdentity } from "../scripts/lifecycle-conformance-policy.mjs";
import {
  canonicalAdmissionEvidence,
} from "./fixtures/agentic-sdlc-admission-evidence.mjs";

const identities = Object.freeze({
  policy: lifecyclePolicyIdentity(),
  evaluator: Object.freeze({
    repository: "huijoohwee/agentic-canvas-os",
    revision: "a".repeat(40),
    digest: "b".repeat(64),
    mechanismId: "agentic-sdlc-admission-evaluator/v1",
  }),
  schema: Object.freeze({
    repository: "huijoohwee/agentic-canvas-os",
    revision: "a".repeat(40),
    digest: "c".repeat(64),
  }),
});

test("complete operation-derived evidence emits one deterministic admission receipt", () => {
  const input = canonicalAdmissionEvidence({ identities });
  const before = structuredClone(input);
  const first = evaluateAdmissionEvidence(input, identities);
  const second = evaluateAdmissionEvidence(structuredClone(input), identities);

  assert.equal(first.schema, "agentic-sdlc-admission-stage-receipt/v1");
  assert.equal(first.verdict, "verified");
  assert.equal(first.ready, true);
  assert.deepEqual(first.enforcedStages, ["admission"]);
  assert.deepEqual(first.unevaluatedStages, [
    "review",
    "integration",
    "runtime",
    "candidate",
    "authorization",
    "deployment",
    "publication",
  ]);
  assert.deepEqual(first.enforcedStages, ADMISSION_ENFORCED_STAGES);
  assert.deepEqual(first.unevaluatedStages, ADMISSION_UNEVALUATED_STAGES);
  assert.equal(first.stageEvidence.inventoryComplete, true);
  assert.deepEqual(first.stageEvidence.coverage, { covered: 1, total: 1 });
  assert.deepEqual(first.findings, []);
  assert.ok(ADMISSION_FINDING_TYPES.every(
    (findingType) => first.findingCounts[findingType] === 0,
  ));
  assert.equal(verifyReceipt(first), true);
  assert.deepEqual(second, first);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(first), true);
});

test("one complete protected dependency closure can be admitted", () => {
  const input = canonicalAdmissionEvidence({
    identities,
    prepare: (draft) => {
      draft.admissionEvidence.dependencies.request = {
        evaluationTime: draft.evaluationTime,
        units: [{ unitId: "1", dependencies: [] }],
        dependencies: [{
          dependencyId: "dependency:protected-contract",
          capabilityId: "capability:protected-contract",
          sourceRevision: "3".repeat(40),
          sourceState: "protected",
          owners: [{
            ownerId: "owner:protected-contract",
            scopeId: "scope:protected-contract",
            fenceRevision: "4".repeat(40),
          }],
          closureDigest: "5".repeat(64),
          evidenceRevision: "3".repeat(40),
          requiredChecks: [{
            name: "protected-integration",
            status: "pass",
          }],
          consumers: ["1"],
          decisionDeadline: "2026-07-30T01:00:00.000Z",
          fallback: {
            type: "defer",
            capabilityId: null,
            sourceRevision: null,
            evidenceDigest: null,
          },
          projectionRequested: false,
        }],
        requestedPlanStop: false,
      };
    },
  });
  const receipt = evaluateAdmissionEvidence(input, identities);

  assert.equal(receipt.verdict, "verified");
  assert.equal(
    receipt.dependencyClosureDigest,
    receipt.stageEvidence.dependencyAdmissionDigest,
  );
  assert.equal(verifyReceipt(receipt), true);
});

test("read and local-execute grants rely on intended use without path scope", () => {
  const input = canonicalAdmissionEvidence({
    identities,
    prepare: (draft) => {
      const grants =
        draft.admissionEvidence.tasks[0].capabilityGrants;
      delete grants.find((grant) =>
        grant.class === "local-execute").scope;
      grants.push({
        class: "read",
        intendedUse: "Inspect the declared source VCC inputs.",
      });
    },
  });
  const receipt = evaluateAdmissionEvidence(input, identities);

  assert.equal(receipt.verdict, "verified");
  assert.equal(verifyReceipt(receipt), true);
});

test("schema-invalid evidence produces a valid blocked domain receipt", () => {
  const input = canonicalAdmissionEvidence({
    identities,
    mutate: (draft) => {
      draft.unexpectedAssertion = true;
    },
  });
  const receipt = evaluateAdmissionEvidence(input, identities);

  assertBlockedWith(receipt, "runtime-readiness-unproven");
  assert.equal(verifyReceipt(receipt), true);
});

test("malformed admission members remain typed blocked evidence", () => {
  const mutations = [
    (input) => {
      delete input.admissionEvidence.collaboration;
    },
    (input) => {
      input.admissionEvidence.collaboration = "not-a-collaboration";
    },
    (input) => {
      delete input.admissionEvidence.executionMechanisms;
    },
  ];
  for (const mutate of mutations) {
    const receipt = evaluateAdmissionEvidence(
      canonicalAdmissionEvidence({ identities, mutate }),
      identities,
    );
    assertBlockedWith(receipt, "runtime-readiness-unproven");
  }
});

test("malformed nested members remain typed blocked evidence", () => {
  const mutations = [
    (input) => {
      input.admissionEvidence.tasks = [null];
    },
    (input) => {
      input.admissionEvidence.vccs = [null];
    },
    (input) => {
      input.admissionEvidence.tasks[0].capabilityGrants = [null];
    },
    (input) => {
      input.admissionEvidence.vccs[0].correctnessProperties = [null];
    },
    (input) => {
      input.admissionEvidence.tasks[0].propertyObligations = [null];
    },
    (input) => {
      input.operations = [null];
    },
  ];
  for (const mutate of mutations) {
    const receipt = evaluateAdmissionEvidence(
      canonicalAdmissionEvidence({ identities, mutate }),
      identities,
    );
    assertBlockedWith(receipt, "runtime-readiness-unproven");
  }
});

test("required admission defects fail closed with typed findings", () => {
  const cases = [
    {
      name: "missing operation",
      findingType: "evidence-without-run",
      mutate: (input) => {
        input.operations = input.operations.filter(
          ({ operationId }) => operationId !== "admission:task-plan",
        );
      },
    },
    {
      name: "producer assertion without a recorded result",
      findingType: "evidence-without-run",
      mutate: (input) => {
        const operation = input.operations[0];
        delete operation.terminalResult.counts;
        operation.resultDigest = digestAdmissionValue({
          terminalResult: operation.terminalResult,
          evidenceReferences: operation.evidenceReferences,
        });
      },
    },
    {
      name: "duplicate member rejected before normalization",
      findingType: "runtime-readiness-unproven",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].writeSet.push(
          input.admissionEvidence.tasks[0].writeSet[0],
        );
      },
    },
    {
      name: "normalized identity collision",
      findingType: "runtime-readiness-unproven",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].writeSet.push(
          ` ${input.admissionEvidence.tasks[0].writeSet[0]} `,
        );
      },
    },
    {
      name: "inconsistent producer result",
      findingType: "evidence-without-run",
      mutate: (input) => {
        const operation = input.operations[0];
        operation.terminalResult.exitCode = 1;
        operation.resultDigest = digestAdmissionValue({
          terminalResult: operation.terminalResult,
          evidenceReferences: operation.evidenceReferences,
        });
      },
    },
    {
      name: "incomplete dependency inventory",
      findingType: "dependency-closure-drift",
      prepare: (input) => {
        input.admissionEvidence.dependencies.inventoryComplete = false;
      },
    },
    {
      name: "uncovered VCC",
      findingType: "unexecuted-condition",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].vccIds = ["VCC-MISSING"];
      },
    },
    {
      name: "task behavior omitted from its source VCC",
      findingType: "ungrounded-task",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].behaviorClaims = ["different-claim"];
      },
    },
    {
      name: "task check differs from its source VCC",
      findingType: "ungrounded-task",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].namedCheck = "npm run unrelated";
      },
    },
    {
      name: "parser without round-trip obligation",
      findingType: "unproven-property",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].behaviorKinds = ["parser"];
      },
    },
    {
      name: "task cycle",
      findingType: "task-cycle",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].dependencyIds = ["1"];
      },
    },
    {
      name: "dependency scheduled in the same wave",
      findingType: "runtime-readiness-unproven",
      prepare: (input) => {
        const dependencyConsumer =
          structuredClone(input.admissionEvidence.tasks[0]);
        dependencyConsumer.taskId = "2";
        dependencyConsumer.dependencyIds = ["1"];
        dependencyConsumer.writeSet = ["src/dependency-consumer.mjs"];
        input.admissionEvidence.tasks.push(dependencyConsumer);
      },
    },
    {
      name: "unbounded task",
      findingType: "unbounded-task",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].budgets.tokens = 0;
      },
    },
    {
      name: "aggregate task budget exceeds specification",
      findingType: "oversized-task",
      mutate: (input) => {
        input.admissionEvidence.specificationTokenEstimate = 50;
      },
    },
    {
      name: "ambiguous grant",
      findingType: "self-escalated-capability",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].capabilityGrants.push({
          class: "local-write",
          intendedUse: "Competing write grant",
          scope: ["src/**"],
        });
      },
    },
    {
      name: "boundary-crossing grant",
      findingType: "deploy-boundary-breach",
      mutate: (input) => {
        input.admissionEvidence.tasks[0].capabilityGrants.push({
          class: "boundary-crossing",
          intendedUse: "Forbidden promotion",
        });
      },
    },
    {
      name: "evaluator equals implementer",
      findingType: "self-graded-verdict",
      mutate: (input) => {
        const mechanisms = input.admissionEvidence.executionMechanisms;
        mechanisms.evaluator.mechanismId =
          mechanisms.implementer.mechanismId;
        mechanisms.evaluator.mechanismDigest =
          mechanisms.implementer.mechanismDigest;
      },
    },
    {
      name: "stale collaboration fence",
      findingType: "stale-collaboration-fence",
      mutate: (input) => {
        input.admissionEvidence.collaboration.status = "expired";
      },
    },
    {
      name: "expired collaboration lease",
      findingType: "stale-collaboration-fence",
      mutate: (input) => {
        input.admissionEvidence.collaboration.expiresAt =
          input.evaluationTime;
      },
    },
  ];

  for (const fixture of cases) {
    const receipt = evaluateAdmissionEvidence(
      canonicalAdmissionEvidence({
        identities,
        prepare: fixture.prepare,
        mutate: fixture.mutate,
      }),
      identities,
    );
    assertBlockedWith(receipt, fixture.findingType, fixture.name);
  }
});

test("repository-owned identity drift raises typed unavailable errors", () => {
  const cases = [
    {
      name: "policy",
      code: "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE",
      mutate: (input) => {
        input.policyIdentity.digest = "0".repeat(64);
      },
    },
    {
      name: "evaluator",
      code: "AGENTIC_SDLC_EVALUATOR_IDENTITY_UNAVAILABLE",
      mutate: (input) => {
        input.evaluatorIdentity.digest = "0".repeat(64);
      },
    },
    {
      name: "schema",
      code: "AGENTIC_SDLC_SCHEMA_IDENTITY_UNAVAILABLE",
      mutate: (input) => {
        input.schemaIdentity.digest = "0".repeat(64);
      },
    },
    {
      name: "source",
      code: "AGENTIC_SDLC_SOURCE_IDENTITY_UNAVAILABLE",
      mutate: (input) => {
        input.sourceIdentity.revision = "mutable";
      },
    },
    {
      name: "source digest",
      code: "AGENTIC_SDLC_SOURCE_IDENTITY_UNAVAILABLE",
      mutate: (input) => {
        input.sourceIdentity.sourceDigest = "0".repeat(64);
      },
    },
    {
      name: "noncanonical source repository",
      code: "AGENTIC_SDLC_SOURCE_IDENTITY_UNAVAILABLE",
      mutate: (input) => {
        input.sourceIdentity.repository =
          ` ${input.sourceIdentity.repository} `;
      },
    },
    {
      name: "dependency closure",
      code: "AGENTIC_SDLC_DEPENDENCY_IDENTITY_UNAVAILABLE",
      mutate: (input) => {
        input.sourceIdentity.dependencyClosureDigest = "d".repeat(64);
      },
    },
  ];

  for (const fixture of cases) {
    const input = canonicalAdmissionEvidence({
      identities,
      mutate: fixture.mutate,
    });
    assert.throws(
      () => evaluateAdmissionEvidence(input, identities),
      (error) => error?.code === fixture.code,
      fixture.name,
    );
  }
});

test("set ordering normalizes without mutating input or changing replay", () => {
  const canonical = canonicalAdmissionEvidence({ identities });
  const reordered = structuredClone(canonical);
  reordered.operations.reverse();
  reordered.operations.forEach((operation) =>
    operation.evidenceReferences.reverse());
  reordered.admissionEvidence.tasks[0].writeSet.reverse();
  reordered.admissionEvidence.tasks[0].capabilityGrants.reverse();
  reordered.admissionEvidence.collaboration.declaredWriteScope.reverse();
  const before = structuredClone(reordered);

  const expected = evaluateAdmissionEvidence(canonical, identities);
  const observed = evaluateAdmissionEvidence(reordered, identities);

  assert.deepEqual(observed, expected);
  assert.deepEqual(reordered, before);
});

test("duplicate identities are rejected deterministically across permutations", () => {
  const first = canonicalAdmissionEvidence({ identities });
  const duplicate = structuredClone(first.operations[0]);
  duplicate.terminalResult.summary = "conflicting duplicate result";
  duplicate.resultDigest = digestAdmissionValue({
    terminalResult: duplicate.terminalResult,
    evidenceReferences: duplicate.evidenceReferences,
  });
  first.operations.push(duplicate);
  const second = structuredClone(first);
  second.operations.reverse();

  const firstReceipt = evaluateAdmissionEvidence(first, identities);
  const secondReceipt = evaluateAdmissionEvidence(second, identities);

  assertBlockedWith(firstReceipt, "evidence-without-run");
  assert.deepEqual(secondReceipt, firstReceipt);
});

test("receipt verification rejects schema, count, stage evidence, and digest tampering", () => {
  const receipt = evaluateAdmissionEvidence(
    canonicalAdmissionEvidence({ identities }),
    identities,
  );
  assert.equal(verifyAdmissionStageReceipt(receipt), false);
  assert.equal(verifyAdmissionStageReceipt(receipt, identities, {
    revision: "0".repeat(40),
    dependencyClosureDigest: receipt.dependencyClosureDigest,
  }), false);
  const mutations = [
    (value) => {
      value.unexpected = true;
    },
    (value) => {
      value.findingCounts["unbounded-task"] = 1;
    },
    (value) => {
      value.stageEvidence.inventoryComplete = false;
    },
    (value) => {
      value.receiptDigest = "0".repeat(64);
    },
  ];

  for (const mutate of mutations) {
    const tampered = structuredClone(receipt);
    mutate(tampered);
    assert.equal(verifyReceipt(tampered), false);
  }

  for (const mutate of [
    (value) => {
      value.stageEvidence.dependencyAdmissionDigest = "f".repeat(64);
    },
    (value) => {
      value.stageEvidence.coverage.covered = 0;
    },
  ]) {
    const semanticallyInvalid = structuredClone(receipt);
    mutate(semanticallyInvalid);
    resealReceipt(semanticallyInvalid);
    assert.equal(verifyReceipt(semanticallyInvalid), false);
  }

  const blocked = evaluateAdmissionEvidence(
    canonicalAdmissionEvidence({
      identities,
      mutate: (input) => {
        input.operations.pop();
      },
    }),
    identities,
  );
  const wrongRule = structuredClone(blocked);
  wrongRule.findings[0].guidelineAnchor = "task-model#1";
  wrongRule.findingSetDigest = digestAdmissionValue({
    findingCounts: wrongRule.findingCounts,
    findings: wrongRule.findings,
  });
  resealReceipt(wrongRule);
  assert.equal(verifyReceipt(wrongRule), false);
});

function assertBlockedWith(receipt, findingType, message = findingType) {
  assert.equal(receipt.verdict, "blocked", message);
  assert.equal(receipt.ready, false, message);
  assert.ok(receipt.findingCounts[findingType] > 0, message);
  assert.ok(
    receipt.findings.some((finding) => finding.findingType === findingType),
    message,
  );
  assert.equal(verifyReceipt(receipt), true, message);
}

function verifyReceipt(receipt) {
  return verifyAdmissionStageReceipt(receipt, identities, {
    revision: "1".repeat(40),
    dependencyClosureDigest: receipt.dependencyClosureDigest,
  });
}

function resealReceipt(receipt) {
  receipt.stageEvidenceDigest =
    digestAdmissionValue(receipt.stageEvidence);
  const body = { ...receipt };
  delete body.receiptDigest;
  receipt.receiptDigest = digestAdmissionValue(body);
}
