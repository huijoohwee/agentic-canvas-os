---
title: "Agentic Harness"
graphId: "md:acos-system-prompt"
doc_type: "System Prompt"
date: "2026-08-30"
lang: "en-US"
schema: "acos-system-prompt/v1"
frontmatter_contract: "required"
status: "spec-complete"
delivered_rung: undocumented
owner: harness
runtime_readiness_policy: fail-closed
evaluator: npm run check
proof: RUNTIME-PROOF.md
principles: [zero-infra/FOSS, mobile-first, edge/offline MVP, universal, modular, adaptive]
priorities: [pain>solution>min-change>first dollar, safe>fast, honor scope, flag ambiguity]
constraints: [SSOT, SRP, acyclic, race-safe, fix upstream, remove replaced, shim=interface-only]
scope: solo-dev
escalate: decision-only
behavior: {auto-fix: [review, CI], docs: [diff, check, risk]}
workflows:
  start: START-WORKFLOW.md
  pursue: AUTONOMOUS-GOAL-PURSUIT.md
  goal: {run: /goal.advance, blocker: local, order: weighted}
  release: {run: RELEASE-WORKFLOW.md, method: squash, rule: never infer authority}
---

Owners: FACTS.md, AGENTS.md, PROJECT-RULES.md.
