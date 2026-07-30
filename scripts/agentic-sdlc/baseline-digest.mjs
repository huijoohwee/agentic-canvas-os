import { createHash } from "node:crypto";

import {
  array,
  compareText,
  stableJson,
  stableValue,
  text,
} from "./normalize.mjs";

export function computeAuthoringBaselineDigest(
  baselineInput,
  vccsInput,
  specificationTokenEstimate,
) {
  return createHash("sha256")
    .update(stableJson(authoringBaselineEnvelope(
      baselineInput,
      vccsInput,
      specificationTokenEstimate,
    )), "utf8")
    .digest("hex");
}

export function authoringBaselineEnvelope(
  baselineInput,
  vccsInput,
  specificationTokenEstimate,
) {
  const baseline = baselineInput ?? {};
  const vccs = array(vccsInput)
    .map(stableValue)
    .sort((left, right) =>
      compareText(stableJson(left), stableJson(right)));
  return {
    schema: "agentic-sdlc-authoring-baseline/v1",
    status: text(baseline.status),
    openBlockerCount: baseline.openBlockerCount,
    prdReference: text(baseline.prdReference),
    tadReference: text(baseline.tadReference),
    existingVerificationLane: text(baseline.existingVerificationLane),
    vccRevision: text(baseline.vccRevision),
    specificationTokenEstimate,
    vccs,
  };
}
