import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  stableWriterMarker,
  stableWriterMarkerDigest,
} from "../scripts/expired-descendant-untracked-scope-recovery-evidence.mjs";

test("stable marker equality ignores only ambient cloud-ledger coordinates", () => {
  const source = {
    branch: "agent/device.local/scope",
    fenceSha: "a".repeat(40),
    cloudAuthority: {
      claimId: "b".repeat(64),
      claimDigest: "c".repeat(64),
      ledgerRevision: "d".repeat(40),
      ledgerDigest: "e".repeat(64),
      transitionCounter: 3,
    },
  };
  const rotated = structuredClone(source);
  rotated.cloudAuthority.ledgerRevision = "f".repeat(40);
  rotated.cloudAuthority.ledgerDigest = "0".repeat(64);
  assert.equal(stableWriterMarkerDigest(source), stableWriterMarkerDigest(rotated));
  rotated.cloudAuthority.claimDigest = "1".repeat(64);
  assert.notEqual(stableWriterMarkerDigest(source), stableWriterMarkerDigest(rotated));
  assert.ok(Object.hasOwn(source.cloudAuthority, "ledgerRevision"));
  assert.ok(!Object.hasOwn(stableWriterMarker(source).cloudAuthority, "ledgerRevision"));
});

test("contract forbids provider and Git effects while restoring only authoring", () => {
  const source = readFileSync(new URL(
    "../scripts/expired-descendant-untracked-scope-recovery-contract.mjs",
    import.meta.url), "utf8");
  assert.match(source, /providerProjection: "deferred"/u);
  assert.match(source, /crossDeviceResumeAuthority: false/u);
  assert.match(source, /pullRequestMutation: false/u);
  assert.match(source, /authoringAuthority: true/u);
  assert.match(source, /integrationAuthority: false/u);
});
