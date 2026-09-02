import test from "node:test";
import assert from "node:assert/strict";

import { SKILL_PROPOSER_DEFAULTS, createSkillProposerRuntime } from "../agent-api/src/skill-proposer.js";
import {
  createInMemoryDraftStore,
  createRecordingObserver,
  createScriptedCandidateAdapter,
  createValidGapSignal,
} from "./lib/native-skill-harness-fakes.mjs";

// Timed p95 gap-to-draft check. Deterministic and network-free: the scripted
// stub adapter stands in for the provider, so this proves the loop's latency
// shape against the declared threshold and makes no end-to-end provider claim.
test("observed p95 gap-to-draft latency stays under the declared threshold", async () => {
  const runs = 40;
  const elapsedSamples = [];
  const traceObserver = createRecordingObserver();

  for (let index = 0; index < runs; index += 1) {
    const draftStore = createInMemoryDraftStore();
    const adapter = createScriptedCandidateAdapter(["valid"]);
    let clock = 0;
    // Simulated per-iteration model time under the declared 2500 ms sub-threshold.
    const advancePerCall = 900 + (index % 5) * 300;
    const wrappedCandidate = async (promptContext) => {
      clock += advancePerCall;
      return adapter.proposeCandidate(promptContext);
    };
    const proposer = createSkillProposerRuntime({
      draftStore,
      proposeCandidate: wrappedCandidate,
      emitTrace: traceObserver.emit,
      now: () => clock,
    });
    const startedAt = clock;
    const result = await proposer.propose(createValidGapSignal({ signal_id: `gap-latency-${index}` }));
    assert.equal(result.draft_agent_definition.status, "proposed");
    elapsedSamples.push(clock - startedAt);
  }

  elapsedSamples.sort((left, right) => left - right);
  const p95Index = Math.min(elapsedSamples.length - 1, Math.ceil(0.95 * elapsedSamples.length) - 1);
  const observedP95 = elapsedSamples[p95Index];
  const threshold = SKILL_PROPOSER_DEFAULTS.p95GapToDraftMs;
  assert.ok(
    observedP95 <= threshold,
    `observed p95 gap-to-draft latency ${observedP95} ms exceeds the declared threshold ${threshold} ms`,
  );
  assert.equal(traceObserver.entries.length, runs);
});
