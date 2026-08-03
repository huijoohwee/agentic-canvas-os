import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { compareLexicalText } from "./lexical-compare.mjs";

export const LIFECYCLE_POLICY_SOURCE = Object.freeze({
  repository: "huijoohwee/huijoohwee.github.io",
  revision: "50a6135ee3ba952f3961a5cab6bd23227499d925",
  digest: "2bd0a430b21d3b15012078836ae975e0cf5d9ff8da53b4b21c070c2dcebe71e9",
  guidelineVersion: "1.10.0",
  modules: Object.freeze([
    "guidelines/agentic-sdlc-cloud-collaboration.md",
    "guidelines/agentic-sdlc-conformance-runtime.md",
    "guidelines/agentic-sdlc-guidelines.md",
    "guidelines/agentic-sdlc-integration-order.md",
    "guidelines/agentic-sdlc-upstream-dependency-admission.md",
    "guidelines/prd-tad-adr-guidelines.md",
  ]),
});

export const LIFECYCLE_POLICY_RULE_CATALOG = Object.freeze({
  "agent-roles--independence#6":
    "A verdict produced by the Implementer about its own task is a `self-graded-verdict` finding at `blocker` severity, regardless of how convincing the output reads",
  "agent-roles--independence#7":
    "Name the mechanism that discharges the Evaluator role before execution starts; forbid execution with an unnamed evaluator",
  "per-task-budgets#1":
    "State all four bounds before dispatch; a task dispatched with any bound unstated is an `unbounded-task` finding at `blocker` severity",
  "runtime-readiness-enforcement#2":
    "Require typed inputs and outputs, bounded orchestration, independent evaluation, named checks with recorded results, cost and fallback evidence, and closed mutation and deployment gates before deriving `runtime-ready`",
  "runtime-readiness-enforcement#5":
    "Emit `runtime-readiness-unproven` at `blocker` severity when a required receipt, join, budget, check, evaluator, dependency, or boundary proof is absent or stale",
  "specification-to-task-bridge#1":
    "Derive every task from at least one VCC; a task tracing to no VCC is an `ungrounded-task`",
  "specification-to-task-bridge#2":
    "Ensure every VCC is covered by at least one task; a VCC with no task is an `unexecuted-condition`",
  "task-model#11":
    "Split a task that exceeds its budget rather than raising the budget; a persistent overrun is a decomposition defect, and raising the bound hides it",
  "task-model#13":
    "Express dependencies as a directed acyclic graph over Task IDs; a cycle is a `task-cycle` finding at `blocker` severity",
  "task-model#14":
    "Derive readiness from the graph: a task is ready when every dependency is in a terminal success state",
  "task-model#15":
    "Group ready tasks into waves for concurrent dispatch; forbid two tasks in one wave writing the same artifact, which is a `concurrent-write-conflict`",
  "tool-permission--blast-radius#2":
    "Forbid self-escalation: an Implementer that needs a wider class returns `blocked` with the reason, and the Orchestrator re-dispatches with a new grant. Widening a grant mid-task is a `self-escalated-capability` finding at `blocker` severity",
  "tool-permission--blast-radius#3":
    "Require an explicit Operator decision per irreversible operation; forbid a standing or session-scoped approval for irreversibility, because a standing approval is indistinguishable from no gate",
  "tool-permission--blast-radius#4":
    "Forbid boundary-crossing capability in any task; promotion is the Deploy Boundary's job, and a task that reaches a delivered surface is a `deploy-boundary-breach` under the authoring set's enumeration",
  "tool-permission--blast-radius#6":
    "State the declared write scope before dispatch; a write outside it is an `out-of-scope-write` finding",
  "validation-checklist#6":
    "**Collaboration identity complete when concurrent mutation applies**; authoritative future write scopes, distinct lanes, and exact fences are present without path inference; current local leases are required only for local mutation-capable projections",
  "verification-strategy#5":
    "Derive a property from every correctness property stated in the specification; a stated property with no executable test is an `unproven-property` finding",
  "verification-strategy#11":
    "Forbid emitting an Evidence Reference for a check that was not run in this task",
});

export function lifecyclePolicyIdentity() {
  const { repository, revision, digest, guidelineVersion } = LIFECYCLE_POLICY_SOURCE;
  return Object.freeze({ repository, revision, digest, guidelineVersion });
}

export function lifecyclePolicyRuleText(ruleId) {
  return LIFECYCLE_POLICY_RULE_CATALOG[String(ruleId)] ?? "";
}

export function verifyPinnedLifecyclePolicySource(repositoryRoot) {
  const root = path.resolve(String(repositoryRoot || ""));
  try {
    execFileSync(
      "git",
      ["cat-file", "-e", `${LIFECYCLE_POLICY_SOURCE.revision}^{commit}`],
      { cwd: root, stdio: "ignore" },
    );
  } catch {
    throw new Error(
      `Lifecycle policy revision ${LIFECYCLE_POLICY_SOURCE.revision} is unavailable.`,
    );
  }
  const modules = LIFECYCLE_POLICY_SOURCE.modules.map((modulePath) => ({
    id: modulePath,
    bytes: execFileSync(
      "git",
      ["show", `${LIFECYCLE_POLICY_SOURCE.revision}:${modulePath}`],
      { cwd: root },
    ),
  }));
  const digest = computeLifecyclePolicyDigest(modules);
  if (digest !== LIFECYCLE_POLICY_SOURCE.digest) {
    throw new Error(
      `Lifecycle policy digest is ${digest}, expected ${LIFECYCLE_POLICY_SOURCE.digest}.`,
    );
  }
  return lifecyclePolicyIdentity();
}

export function computeLifecyclePolicyDigest(modules) {
  const ordered = [...modules].sort((left, right) =>
    compareLexicalText(left.id, right.id));
  const hash = createHash("sha256");
  for (const module of ordered) {
    const identity = Buffer.from(String(module.id), "utf8");
    const bytes = Buffer.isBuffer(module.bytes)
      ? module.bytes
      : Buffer.from(module.bytes);
    hash.update(lengthPrefix(identity.length));
    hash.update(identity);
    hash.update(lengthPrefix(bytes.length));
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function lengthPrefix(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}
