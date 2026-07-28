import assert from "node:assert/strict";
import { fc, propertyTest as test } from "./lib/alignment-audit-fast-check.mjs";

import {
  checkEconomics,
  DEFAULT_ECONOMICS_STATEMENTS,
} from "../scripts/alignment-audit/economics-checker.mjs";

const ECONOMICS_LINES = Object.freeze({
  "return-on-investment": "Return on investment: positive at the target reach.",
  "12-month-total-cost-of-ownership": "12-month total cost of ownership: $0.",
  "token-budget": "Token budget: 1000 tokens per run.",
  "time-to-value": "Time-to-value: under five minutes.",
});
const DELIVERY_LINES = Object.freeze({
  "browser-reach": "Browser reach: current evergreen browsers.",
  "mobile-reach": "Mobile reach: responsive web access.",
  "offline-behavior": "Offline behavior: cached read-only mode.",
});
const PAID_READ_LINES = Object.freeze([
  "Discovery read view token cost: $VALUE.",
  "Discovery view costs VALUE token.",
  "The read view costs $VALUE per request.",
  "Discovery uses VALUE tokens per read.",
  "The discovery token cost equals VALUE.",
]);
const DISCRIMINATORS = ["none", "blended", "proprietary", "unbounded", "paid"];

// Feature: guideline-runtime-alignment-audit, Property 15: Economics statement detection with per-omission multiplicity
test("Property 15: economics and delivery omissions have exact multiplicity", () => {
  fc.assert(fc.property(
    fc.subarray(DEFAULT_ECONOMICS_STATEMENTS),
    fc.subarray(Object.keys(DELIVERY_LINES)),
    fc.constantFrom(...DISCRIMINATORS),
    fc.boolean(),
    fc.constantFrom(
      "A proprietary dependency is selected.",
      "Stripe API is selected.",
      "Datadog service is required.",
    ),
    fc.constantFrom(...PAID_READ_LINES),
    (presentEconomics, presentDelivery, discriminator, nearMiss, proprietaryLine, paidReadLine) => {
      const lines = [
        ...presentEconomics.map((statement) => ECONOMICS_LINES[statement]),
        ...presentDelivery.map((dimension) => DELIVERY_LINES[dimension]),
      ];
      if (discriminator === "blended") {
        lines.push(nearMiss
          ? "12-month TCO: managed $10; self-managed $20."
          : "12-month TCO: managed and self-managed combined = $20.");
      } else if (discriminator === "proprietary") {
        lines.push(proprietaryLine);
        if (nearMiss) {
          const dependency = proprietaryLine.startsWith("A proprietary")
            ? "proprietary dependency"
            : proprietaryLine.split(" ")[0];
          lines.push(`FOSS alternative comparison: open-source option versus ${dependency}.`);
        }
      } else if (discriminator === "unbounded") {
        lines.push("AI pipeline: agentic execution.");
        if (nearMiss) lines.push("Maximum iterations: 4. Circuit-breaker condition: stop on repeated error.");
      } else if (discriminator === "paid") {
        lines.push(paidReadLine.replace("VALUE", nearMiss ? "0" : "1.25"));
      }
      const findings = checkEconomics([{
        documentKey: "feature",
        featureBearing: true,
        userFacing: true,
        aiPipeline: discriminator === "unbounded",
        body: lines.join("\n"),
      }]);
      const effectiveEconomics = new Set(presentEconomics);
      if (discriminator === "blended") {
        effectiveEconomics.add("12-month-total-cost-of-ownership");
      }
      const missingEconomics = DEFAULT_ECONOMICS_STATEMENTS.filter((statement) =>
        !effectiveEconomics.has(statement));
      const missingDelivery = Object.keys(DELIVERY_LINES).filter((dimension) =>
        !presentDelivery.includes(dimension));
      assert.deepEqual(
        findings
          .filter(({ findingType }) => findingType === "missing-economics-metric")
          .map(({ evidenceExcerpt }) => evidenceExcerpt.replace("Missing economics statement: ", ""))
          .sort(),
        [...missingEconomics].sort(),
      );
      assert.deepEqual(
        findings
          .filter(({ findingType }) => findingType === "incomplete-delivery-reach")
          .map(({ evidenceExcerpt }) => evidenceExcerpt.replace("Missing delivery statement: ", ""))
          .sort(),
        [...missingDelivery].sort(),
      );

      const expectedType = {
        blended: "blended-deployment-tco",
        proprietary: "missing-foss-comparison",
        unbounded: "unbounded-loop",
        paid: "paid-read-path",
      }[discriminator];
      if (expectedType) {
        const relevant = findings.filter(({ findingType }) => findingType === expectedType);
        assert.equal(relevant.length, nearMiss ? 0 : 1);
        if (expectedType === "unbounded-loop" && relevant.length > 0) {
          assert.equal(relevant[0].severity, "blocker");
        }
      }
    },
  ), { numRuns: 100 });
});
