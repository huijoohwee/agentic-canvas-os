import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import {
  deriveDeployBoundaryState,
  gateRemediation,
} from "../scripts/alignment-audit/deploy-gate.mjs";
import { evaluateReadiness } from "../scripts/alignment-audit/readiness-evaluator.mjs";

const ACTIONS = ["Deploy", "Publish", "Update", "Remove"];
const SURFACES = ["production", "edge", "public edge"];
const STATUSES = [
  "runtime-ready",
  "production-verified",
  "dev-proven",
  "off-ladder",
];

// Feature: guideline-runtime-alignment-audit, Property 11: Deploy safety without an operator instruction
test("Property 11: a null operator instruction keeps every deploy path closed", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          action: fc.constantFrom(...ACTIONS),
          surface: fc.constantFrom(...SURFACES),
          declaredStatus: fc.constantFrom(...STATUSES),
        }),
        { minLength: 1, maxLength: 8 },
      ),
      fc
        .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), {
          minLength: 1,
          maxLength: 20,
        })
        .map((characters) => `operator-${characters.join("")}`),
      (inputs, instructionRef) => {
        const chains = inputs.map((input, index) => ({
          capabilityId: `capability-${index}`,
          entryIds: [`entry-${index}`],
          declaredStatus: input.declaredStatus,
          conditions: [{
            conditionId: `condition-${index}`,
            endState: `Capability ${index} is verified.`,
            statedCheck: `verify-${index}`,
            constraint: "configured production surface",
          }],
          evidence: [
            {
              conditionId: `condition-${index}`,
              checkName: `verify-${index}`,
              recordedResult: "passed",
              reproducible: "local",
            },
            {
              conditionId: `condition-${index}`,
              checkName: `verify-${index}`,
              recordedResult: "passed",
              reproducible: "production",
            },
          ],
        }));
        const remediations = inputs.map((input, index) => ({
          class: "local-reproducible-check",
          statement: `${input.action} capability ${index} to the ${input.surface} surface.`,
          state: "proposed",
          operatorInstructionRef: null,
        }));

        const closedAssignments = evaluateReadiness(chains, null).assignments;
        const closedRemediations = remediations.map((item) =>
          gateRemediation(item, null));
        assert.equal(deriveDeployBoundaryState(null), "closed");
        assert.equal(
          closedAssignments.some(({ assignedLevel, deployedReadiness }) =>
            assignedLevel === "production-verified" ||
            deployedReadiness === "production-verified"),
          false,
        );
        assert.equal(
          closedRemediations.some(({ state }) => state === "operator-approved"),
          false,
        );
        for (const remediation of closedRemediations) {
          assert.equal(remediation.state, "deploy-gated");
          assert.equal(remediation.operatorInstructionRef, null);
        }

        const instruction = { reference: instructionRef };
        const openAssignments = evaluateReadiness(chains, instruction).assignments;
        const approvedRemediations = remediations.map((item) =>
          gateRemediation(item, instruction));
        assert.equal(deriveDeployBoundaryState(instruction), "open");
        assert.ok(
          openAssignments.every(({ assignedLevel }) =>
            assignedLevel === "production-verified"),
        );
        for (const remediation of approvedRemediations) {
          assert.equal(remediation.state, "operator-approved");
          assert.equal(remediation.operatorInstructionRef, instructionRef);
        }
      },
    ),
    { numRuns: 100 },
  );
});
