import assert from "node:assert/strict";
import test from "node:test";
import { parseRecoveryArtifactRetirementArguments } from "../scripts/recovery-artifact-retirement.mjs";

test("CLI parses one exact recovery subject", () => {
  const parsed = parseRecoveryArtifactRetirementArguments(["plan", "--repository=/owner", "--source=/recovery/one",
    "--archive-root=/archive", "--subject-repository=/subject", "--session=s", `--operator-decision-digest=${"a".repeat(64)}`]);
  assert.equal(parsed.mode, "plan"); assert.equal(parsed.input.source, "/recovery/one");
});

test("CLI rejects unsupported purge and relative paths", () => {
  assert.throws(() => parseRecoveryArtifactRetirementArguments(["purge"]), /plan, run, or observe/u);
  assert.throws(() => parseRecoveryArtifactRetirementArguments(["observe", "--repository=owner"]), /normalized non-root absolute/u);
});
